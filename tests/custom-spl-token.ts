import * as anchor from "@project-serum/anchor";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
  Mint,
} from "@solana/spl-token";
import { expect } from "chai";
import { CustomSplToken } from "../target/types/custom_spl_token";
// import fs from "mz/fs";

// TIL:
// - PDAs can only sign from within program context!
// - The Mint account MUST be WRITABLE (mut) to mint supply!
// - Need globals for dappTokenManager, dappTokenMint
// - Error: Failed to resolve options IDL -- check input accounts types!
// - InstructionError: IllegalOwner - Provided owner is not allowed (minting to user1TokenAccount)
// - SK Hooks (see Notion)
// - create() + init_if_needed feature vs. create_idempotent()

// async function createKeypairFromFile(
//   filepath: string
// ): Promise<anchor.web3.Keypair> {
//   const secretKeyString = await fs.readFile(filepath, {
//     encoding: "utf8",
//   });
//   const secretKey = Uint8Array.from(JSON.parse(secretKeyString));
//   return anchor.web3.Keypair.fromSecretKey(secretKey);
// }

describe("custom-spl-token", () => {

  const provider = anchor.AnchorProvider.env();
  // NOTE We use anchor.Wallet to help with typing
  const wallet = provider.wallet as anchor.Wallet;
  anchor.setProvider(provider);
  const program = anchor.workspace
    .CustomSplToken as anchor.Program<CustomSplToken>;

  // Get a mint address for the program
  // IMPORTANT: I'll have to move this Keypair out of this test
  // when I want to have ONE SINGLE token for the program
  const mintKeypair: anchor.web3.Keypair = anchor.web3.Keypair.generate();
  console.log(`New token (mint): ${mintKeypair.publicKey}`);
  // Create dappTokenMint global to track
  let dappTokenMint: Mint;

  // Create dappTokenManager for program
  let dappTokenManager: anchor.IdlAccounts<CustomSplToken>['dappTokenManager'];
  // - Derive a PDA between mint + program for dappTokenManager
  const [dappTokenManagerPda, dappTokenManagerBump] = anchor.utils.publicKey.findProgramAddressSync(
    [
      Buffer.from("dapp-token-manager"),
      mintKeypair.publicKey.toBuffer(),
    ],
    program.programId
  )
  console.log("dappTokenManagerPda: ", dappTokenManagerPda);
  const ONE_TOKEN_AMOUNT_RAW = 1000000000;
  const MINT_AMOUNT_RAW = ONE_TOKEN_AMOUNT_RAW * 100; // 100 full tokens
  const MINT_AMOUNT_UI = 100; // 100 full tokens

  // Create a couple user wallets to test with
  const user1Wallet = anchor.web3.Keypair.generate();
  const user2Wallet = anchor.web3.Keypair.generate();
  console.log("user1Wallet: ", user1Wallet.publicKey.toBase58());
  console.log("user2Wallet: ", user2Wallet.publicKey.toBase58());
  let user1TokenAccount;
  let user2TokenAccount;

  // U: Testing out updated initializeDappSpl instruction
  before(async () => {

    // 1. Ensure our wallets have SOL
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        user1Wallet.publicKey,
        anchor.web3.LAMPORTS_PER_SOL * 2
      )
    );
    console.log(
      `user1Wallet balance: ${await provider.connection.getBalance(user1Wallet.publicKey)}`
    );

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        user2Wallet.publicKey,
        anchor.web3.LAMPORTS_PER_SOL * 2
      )
    );
    console.log(
      `user2Wallet balance: ${await provider.connection.getBalance(user2Wallet.publicKey)}`
    );

    // ====== May come back to this when trying to set up SINGLE SPL =====
    // // 2. Setup the dApp Token
    // // UPDATE: Found out thanks to Joe that a program-specific SPL token isn't
    // // that complicated after all. I just need to create a PDA between the
    // // program and the mint, and then set the mint.authority = PDA. Then I
    // // can mintToChecked() by signing the 'mint' CPI to Token Program, 
    // // by using the PDA's seeds!
    // // Following Joe's advice:
    // // 1. Need a PDA between Mint and Program
    // // 1.1 Create the Mint to get its address
    // // NOTE: spl-token create-token (paid with my wallet)
    // const MINT_ADDRESS = new anchor.web3.PublicKey("ANkycvSnegdXy4sBBqDjXb5eW1p8qRTzvKhHtX8NTTP9");
    // // 1.2 Create the PDA
    // const CUSTOM_SPL_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("cPshoEnza1TMdWGRkQyiQQqu34iMDTc7i3XT8uVVfjp");
    // let DAPP_TOKEN_PDA: anchor.web3.PublicKey;
    // let DAPP_TOKEN_BUMP: number;

    // function getDappTokenPdaAndBump() {
    //   // Derive the PDA address
    //   [DAPP_TOKEN_PDA, DAPP_TOKEN_BUMP] = anchor.utils.publicKey.findProgramAddressSync(
    //     [
    //       MINT_ADDRESS.toBuffer(),
    //       CUSTOM_SPL_TOKEN_PROGRAM_ID.toBuffer()
    //     ],
    //     CUSTOM_SPL_TOKEN_PROGRAM_ID
    //   )
    // }

    // getDappTokenPdaAndBump();

    // // 2. Make PDA the mint authority
    // // NOTE setAuthority() won't work since Wallet != Signer.
    // // Need to manually build the tx
    // async function setMintAuthority() {
    //   // NOTE: New Versioned Transaction approach
    //   // REF: https://docs.solana.com/developing/versioned-transactions
    //   let minRent = await provider.connection.getMinimumBalanceForRentExemption(0);
    //   const latestBlockhash = await provider.connection.getLatestBlockhash();

    //   let ix = createSetAuthorityInstruction(
    //     MINT_ADDRESS, // mint account
    //     null, // current auth
    //     AuthorityType.MintTokens, // authority type
    //     DAPP_TOKEN_PDA // new authority
    //   );
    //   const instructions = [
    //     ix,
    //   ];

    //   const messageV0 = new anchor.web3.TransactionMessage({
    //     payerKey: wallet.publicKey,
    //     recentBlockhash: latestBlockhash.blockhash,
    //     instructions,
    //   }).compileToV0Message();
    //   console.log('messageV0: ', messageV0);

    //   const tx = new anchor.web3.VersionedTransaction(messageV0);
    //   // Sign the transaction with required 'Signers'
    //   tx.sign([wallet.payer]);

    //   // Send our v0 transaction to the cluster
    //   const txid = await provider.connection.sendTransaction(tx);
    //   console.log(`https://explorer.solana.com/tx/${txid}?cluster=devnet`);
    // }

    // // Now use the new setAuthority function
    // await setMintAuthority();

  });


  it("Create dappTokenManager", async () => {
    // Get a mint address
    // pub const SEED_PREFIX: &'static str = "dapp-token-manager";

    const tx = await program.methods
      .initializeDappSpl()
      .accounts({
        mint: mintKeypair.publicKey,
        dappTokenManager: dappTokenManagerPda,
        authority: wallet.publicKey,
      })
      // NOTE I was right that the mintKeypair and wallet are signers,
      // but you don't pass wallet as signer for Anchor. It already knows.
      .signers([mintKeypair])
      .rpc({ skipPreflight: true }); // Get better logs
    console.log("tx:", tx);

    // Check that SPL was created and supply minted
    dappTokenManager = await program.account.dappTokenManager.fetch(
      dappTokenManagerPda
    );
    console.log("dappTokenManager: ", dappTokenManager);

    dappTokenMint = await getMint(provider.connection, dappTokenManager.mint);
    console.log("dappSplMint: ", dappTokenMint);

    expect(dappTokenManager.mint.toBase58()).to.equal(mintKeypair.publicKey.toBase58());
    expect(dappTokenManager.totalUserMintCount.toNumber()).to.equal(0);
    expect(dappTokenManager.bump).to.equal(dappTokenManagerBump);
    expect(dappTokenMint.mintAuthority.toBase58()).to.equal(dappTokenManagerPda.toBase58());
    expect(dappTokenMint.freezeAuthority.toBase58()).to.equal(dappTokenManagerPda.toBase58());
  });

  it("Mint dappSPL Supply to user1Wallet", async () => {
    // Create a new ATA for user using getOrCreateAssociatedTokenAccount()
    // NOTE Use this since Accounts struct does not init ATA. Only checks constraints.
    // U: Wrapping inside a try/catch to help debug
    try {

      // === FAILS: Trying getOrCreateAssociatedTokenAccount()
      // U: Fails with TokenAccountNotFoundError
      // user1TokenAccount = await getOrCreateAssociatedTokenAccount(
      //   provider.connection,
      //   user1Wallet, // payer (Keypair/Payer)
      //   // mintKeypair.publicKey, // mint
      //   dappTokenManager.mint, // mint
      //   // dappTokenMint.address, // mint
      //   user1Wallet.publicKey, // owner
      //   false, // allowOwnerOffCurse (for PDAs)
      //   "confirmed", // commitment
      //   { skipPreflight: true },
      //   TOKEN_PROGRAM_ID, // tokenProgram,
      //   ASSOCIATED_TOKEN_PROGRAM_ID // associatedTokenProgram
      // );
      // console.log('user1TokenAccount: ', user1TokenAccount);

      // === WORKS: Building manually using combo of getAssociatedTokenAddress(),
      // createAssociatedTokenAccountInstruction(), etc.
      // REF: Escrow Program - routes/escrow/[pda]/+page.svelte
      user1TokenAccount = getAssociatedTokenAddressSync(
        mintKeypair.publicKey, // mint
        user1Wallet.publicKey // owner
      );
      console.log('user1TokenAccount: ', user1TokenAccount);

      // Newest VersionedTransaction syntax:
      let minRent = await provider.connection.getMinimumBalanceForRentExemption(0);
      const latestBlockhash = await provider.connection.getLatestBlockhash();

      const instructions = [
        createAssociatedTokenAccountInstruction(
          user1Wallet.publicKey, // payer
          user1TokenAccount, // ata
          user1Wallet.publicKey, // owner
          mintKeypair.publicKey, // mint
        ),
      ];

      const messageV0 = new anchor.web3.TransactionMessage({
        payerKey: user1Wallet.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions,
      }).compileToV0Message();
      console.log('messageV0: ', messageV0);

      const tx = new anchor.web3.VersionedTransaction(messageV0);
      // Sign the transaction with required 'Signers'
      tx.sign([user1Wallet]);

      // Send our v0 transaction to the cluster
      const txid = await provider.connection.sendTransaction(tx);
      console.log("txid: ", txid);
      // console.log(`https://explorer.solana.com/tx/${txid}?cluster=devnet`);

    } catch (error: any) {
      console.log('error: ', error); // TokenAccountNotFoundError when using getOrCreateAssociatedTokenAccount()
    }

    // FIXME: TokenAccountNotFoundError
    // When I run my tests, I've gotten a few errors, but
    // this one comes up the most. One possibility is
    // that the user1TokenAccount hasn't finalized getting
    // created before the program method is invoked, and therefore
    // causes this error.
    // U: Seems to error during getOrCreateAssociatedTokenAccount()...
    // U: Could consider removing ata_create() IX from inside
    // program mint_dapp_spl() handler, since getOrCreateAssociatedTokenAccount()
    // is already doing that I believe....
    // U: May not need the associated_token::create() inside
    // program. Escrow accept() doesn't have it (only has token::transfer())
    // but Escrow accept() does use client getOrCreateAssociatedTokenAccount()
    // U: PROGRESS. I removed program associated_token::create() ix from
    // inside mint_dapp_spl(). Also replaced mintKeypair.publicKey
    // with dappTokenManager.mint and this was better! The user1TokenAccount
    // was actually created (see logs). Now encountering a raw constraint
    // violation error for user_token_account. I think the .mint addresses
    // match, but the user_token_account.owner == user.key() constraint may fail
    // since I didn't pass the user account. Again, currently, I have my dTM PDA
    // signing the mint_to() IX, and after removing the ata_create(), I also
    // commented out the user input account. Let me try adding user account again
    // and if that doesn't work, then I could remove the owner = user.key() constraint...
    // U: TokenAccountNotFoundError after adding back user input account.
    setTimeout(
      async () => { console.log('Waiting for user1TokenAccount to be created...'); },
      3000
    );

    // NOTE If I DON'T have ata_create() IX in program,
    // then token::mint_to() needs: token_program, mint, user_token_account,
    // dapp_token_manager (user doesn't seem needed...)
    // U: After manually building createAssociatedTokenAccountInstruction(),
    // user1TokenAccount is getting created. However, now when
    // it gets here, I get InstructionError: PrivilegeEscalation.
    // I'm signing the mint_to() with my PDA, but need to check that
    // Mint account is writable (may need to use 'mut' but not sure)...
    // A: SOLVED! Mint MUST be WRITABLE (mut) to mint supply!
    const tx = await program.methods
      .mintDappSpl()
      .accounts({
        // user: user1Wallet.publicKey,
        mint: mintKeypair.publicKey,
        dappTokenManager: dappTokenManagerPda,
        userTokenAccount: user1TokenAccount as anchor.web3.PublicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        // associatedTokenProgram
      })
      // .signers([user1Wallet])
      // .signers([]) // NOTE: dappTokenManager PDA signs inside program
      .rpc({ skipPreflight: true }); // Get better logs
    console.log("TxHash ::", tx);

    // Fetch updated accounts data
    dappTokenManager = await program.account.dappTokenManager.fetch(dappTokenManagerPda);

    dappTokenMint = await getMint(
      provider.connection,
      mintKeypair.publicKey
    );
    console.log('dappTokenMint: ', dappTokenMint);
    
    // Q: How to work with type 'bigint'?
    // A: Use * operator and express in whole numbers of use Number()
    // REF: https://stackoverflow.com/questions/71636101/how-to-divide-bigint-by-decimal-in-javascript
    // Example 1:
    // const n = BigInt(100000000000);
    // const x = BigInt(100); // 100n
    // const result = n * x;
    // console.log('result: ', result.toString()); // 10000000000000

    // Example 2:
    // const n = BigInt(ONE_TOKEN_AMOUNT_RAW); // 1000000000n
    // const x = BigInt(MINT_AMOUNT_UI); // 100n
    // const numerator = n * x; // 100000000000n
    // console.log('numerator: ', numerator.toString()); // 100000000000
    // const denominator = BigInt(Math.pow(10, 9)); // 1000000000n
    // const result = numerator / denominator; 
    // console.log('result: ', result.toString()); // 100


    // Example 3:
    const supplyUiAmountStr = (dappTokenMint.supply / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString(); // ?
    console.log('supplyUiAmountStr: ', supplyUiAmountStr);
    console.log('Math.pow(10,9): ', Math.pow(10, 9)); // 1000000000 (1 token)
    console.log('BigInt(Math.pow(10,9)): ', BigInt(Math.pow(10, 9))); // 1000000000n
    console.log('dappTokenMint.supply.valueOf(): ', dappTokenMint.supply.valueOf()); // 100000000000n
    console.log('dappTokenMint.supply.toString(): ', dappTokenMint.supply.toString()); // 100000000000
    console.log('dappTokenMint.supply.valueOf(): ', dappTokenMint.supply.toString()); // 100000000000

    const currentUser1TokenAccountBalance = await provider.connection.getTokenAccountBalance(
      user1TokenAccount
    );
    console.log('currentUser1TokenAccountBalance: ', currentUser1TokenAccountBalance);

    const currentUser1TokenAccountInfo = await getAccount(
      provider.connection,
      user1TokenAccount
    )
    console.log('currentUser1TokenAccountInfo.amount.valueOf: ', currentUser1TokenAccountInfo.amount.valueOf()); // 100000000000n
    console.log('currentUser1TokenAccountInfo.amount.toString: ', currentUser1TokenAccountInfo.amount.toString()); // 100000000000


    // ===== TODO ======
    // TODO Assertions
    // - Mint supply should be MINT_AMOUNT 
    // expect(dappTokenMint.supply.valueOf())
    // - dappTokenManager.totalUserMintCount is 1
    expect(dappTokenManager.totalUserMintCount.toNumber()).to.equal(1);
    // - user1TokenAccountBalance is MINT_AMOUNT
    expect(currentUser1TokenAccountBalance.value.uiAmount).to.equal(MINT_AMOUNT_UI);
    // expect(currentUser1TokenAccountInfo.amount.valueOf().value.uiAmount).to.equal(MINT_AMOUNT_UI);
    // - user1TokenAccount.owner should be user1Wallet.pubkey
    expect(currentUser1TokenAccountInfo.owner.toBase58()).to.equal(user1Wallet.publicKey.toBase58())
  })

});

