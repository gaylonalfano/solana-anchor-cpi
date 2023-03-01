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
import { createKeypairFromFile } from "./utils";
// import fs from "mz/fs";

// TIL:
// - PDAs can only sign from within program context!
// - The Mint account MUST be WRITABLE (mut) to mint supply!
// - Need globals for dappTokenManagerV1, dappTokenMintV1
// - Error: Failed to resolve options IDL -- check input accounts types!
// - InstructionError: IllegalOwner - Provided owner is not allowed (minting to user1TokenAccount)
// - SK Hooks (see Notion)
// - create() + init_if_needed feature vs. create_idempotent()
// - BigInt arithmetic
// - If signing with PDA, MUST find PDA and pass from CLIENT to IX
// - init_if_needed only needs getAssociatedTokenAddressSync() for
//   the user_token_account. Just pass the Pubkey and that's it!
// - Max seed length error: Use PublicKey.toBuffer() instead of
//   Buffer.from(raw string) - must be smaller in bytes /shrug

// Q: Can I test out a persistant Token on localhost? Now that I have
// a DappTokenManagerV3 approach?

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
  // IMPORTANT: Have to move this Keypair out of this test
  // when I want to have ONE SINGLE token for the program
  // NOTE The temp Keypairs do not persist. Need to get from file.
  const mintKeypair1: anchor.web3.Keypair = anchor.web3.Keypair.generate();
  console.log(`New token (mint): ${mintKeypair1.publicKey}`);
  // Create dappTokenMintV1 global to track
  let dappTokenMintV1: Mint;

  // Create dappTokenManagerV1 for program
  let dappTokenManagerV1: anchor.IdlAccounts<CustomSplToken>['dappTokenManagerV1'];
  // - Derive a PDA between mint + program for dappTokenManagerV1
  const [dappTokenManagerV1Pda, dappTokenManagerBump] = anchor.utils.publicKey.findProgramAddressSync(
    [
      Buffer.from("dapp-token-manager-v1"),
      mintKeypair1.publicKey.toBuffer(),
    ],
    program.programId
  )
  console.log("dappTokenManagerV1Pda: ", dappTokenManagerV1Pda);

  // For Version2
  const mintKeypair2: anchor.web3.Keypair = anchor.web3.Keypair.generate();
  console.log(`New token (mint): ${mintKeypair2.publicKey}`);
  // Create dappTokenMintV2 global to track
  let dappTokenMintV2: Mint;

  // Create dappTokenManagerV2 for program
  let dappTokenManagerV2: anchor.IdlAccounts<CustomSplToken>['dappTokenManagerV2'];
  // - Derive a PDA between mint + program for dappTokenManagerV2
  const [dappTokenManagerV2Pda, dappTokenManagerV2Bump] = anchor.utils.publicKey.findProgramAddressSync(
    [
      Buffer.from("dapp-token-manager-v2"),
      mintKeypair2.publicKey.toBuffer(),
    ],
    program.programId
  )
  console.log("dappTokenManagerV2Pda: ", dappTokenManagerV2Pda);

  // For Version3 with persistant Token 
  const mintKeypair3: anchor.web3.Keypair = anchor.web3.Keypair.generate();
  console.log(`New token (mint): ${mintKeypair3.publicKey}`);
  // Create dappTokenMintV3 global to track
  let dappTokenMintV3: Mint;

  // Create dappTokenMintPersist for program
  // 1. Create new keygen JSON file: solana keygen grind
  // 2. Create Keypair from file using helper in before()
  // 3. Pass Keypair as Signer in initializeDappTokenManagerAndTokenMintV3
  const dappTokenMintPersistAddressString = "CSt37xN2JnW1uLQDwBFeNkJArqWvSkzuEynssjoT5Y8W";
  const dappTokenMintPersistPubkey = new anchor.web3.PublicKey(dappTokenMintPersistAddressString);
  let dappTokenMintPersistKeypair: anchor.web3.Keypair;
  let dappTokenMintPersist: Mint;

  // Create dappTokenManagerV3 for program
  let dappTokenManagerV3: anchor.IdlAccounts<CustomSplToken>['dappTokenManagerV3'];
  // - Derive a PDA between mint + program for dappTokenManagerV3
  const [dappTokenManagerV3Pda, dappTokenManagerV3Bump] = anchor.utils.publicKey.findProgramAddressSync(
    [
      Buffer.from("dapp-token-manager-v3"),
      // U: Swapping out temp mint for persisting mint
      // mintKeypair3.publicKey.toBuffer(),
      // Q: FIXME Error: max seed length exceeded
      // Buffer.from("CSt37xN2JnW1uLQDwBFeNkJArqWvSkzuEynssjoT5Y8W"), // Error
      // Buffer.from(dappTokenMintPersistAddressString), // Error
      // A: Works! Had to pass PublicKey.toBuffer() instead! Must 'pack' to smaller
      // bytes vs raw string. /shrug
      dappTokenMintPersistPubkey.toBuffer(), // Works! 
    ],
    program.programId
  )
  console.log("dappTokenManagerV3Pda: ", dappTokenManagerV3Pda);


  const ONE_TOKEN_AMOUNT_RAW = 1000000000;
  const MINT_AMOUNT_RAW = ONE_TOKEN_AMOUNT_RAW * 100; // 100 full tokens
  const MINT_AMOUNT_UI = 100; // 100 full tokens

  // Create a couple user wallets to test with
  const user1Wallet = anchor.web3.Keypair.generate();
  const user2Wallet = anchor.web3.Keypair.generate();
  const user3Wallet = anchor.web3.Keypair.generate();
  const user4Wallet = anchor.web3.Keypair.generate();
  // console.log("user1Wallet: ", user1Wallet.publicKey.toBase58());
  // console.log("user2Wallet: ", user2Wallet.publicKey.toBase58());
  // console.log("user3Wallet: ", user3Wallet.publicKey.toBase58());
  console.log("user4Wallet: ", user4Wallet.publicKey.toBase58());
  let user1TokenAccount;
  let user2TokenAccount;
  let user3TokenAccount;
  let user4TokenAccount;

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

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        user3Wallet.publicKey,
        anchor.web3.LAMPORTS_PER_SOL * 2
      )
    );
    console.log(
      `user3Wallet balance: ${await provider.connection.getBalance(user3Wallet.publicKey)}`
    );

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        user4Wallet.publicKey,
        anchor.web3.LAMPORTS_PER_SOL * 2
      )
    );
    console.log(
      `user4Wallet balance: ${await provider.connection.getBalance(user4Wallet.publicKey)}`
    );

    // 2. Create the PERSISTING dApp Token Mint
    // Persistant Token (instead of temp Keypairs)
    // Let's create our Keypair from the keypair file
    // console.log('__dirname:', __dirname);
    dappTokenMintPersistKeypair = await createKeypairFromFile(
      __dirname + `/keypairs/${dappTokenMintPersistAddressString}.json`
    );
    // console.log("dappTokenMintPersistKeypair: ", dappTokenMintPersistKeypair);
    console.log("dappTokenMintPersistKeypair.publicKey: ", dappTokenMintPersistKeypair.publicKey);

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


  xit("Create dappTokenManagerV1", async () => {
    // Get a mint address
    // pub const SEED_PREFIX: &'static str = "dapp-token-manager";

    const tx = await program.methods
      .initializeDappSplWithKeypair()
      .accounts({
        mint: mintKeypair1.publicKey,
        dappTokenManagerV1: dappTokenManagerV1Pda,
        authority: wallet.publicKey,
      })
      // NOTE I was right that the mintKeypair1 and wallet are signers,
      // but you don't pass wallet as signer for Anchor. It already knows.
      .signers([mintKeypair1])
      .rpc({ skipPreflight: true }); // Get better logs
    console.log("tx:", tx);

    // Check that SPL was created and supply minted
    dappTokenManagerV1 = await program.account.dappTokenManagerV1.fetch(
      dappTokenManagerV1Pda
    );
    console.log("dappTokenManagerV1: ", dappTokenManagerV1);

    dappTokenMintV1 = await getMint(provider.connection, dappTokenManagerV1.mint);
    console.log("dappSplMint: ", dappTokenMintV1);

    expect(dappTokenManagerV1.mint.toBase58()).to.equal(mintKeypair1.publicKey.toBase58());
    expect(dappTokenManagerV1.totalUserMintCount.toNumber()).to.equal(0);
    expect(dappTokenManagerV1.bump).to.equal(dappTokenManagerBump);
    expect(dappTokenMintV1.mintAuthority.toBase58()).to.equal(dappTokenManagerV1Pda.toBase58());
    expect(dappTokenMintV1.freezeAuthority.toBase58()).to.equal(dappTokenManagerV1Pda.toBase58());
  });

  xit("Mint dappSPL Supply to user1Wallet", async () => {
    // Create a new ATA for user using getOrCreateAssociatedTokenAccount()
    // NOTE Use this since Accounts struct does not init ATA. Only checks constraints.
    // U: Wrapping inside a try/catch to help debug
    try {

      // === FAILS: Trying getOrCreateAssociatedTokenAccount()
      // U: Fails with TokenAccountNotFoundError
      // user1TokenAccount = await getOrCreateAssociatedTokenAccount(
      //   provider.connection,
      //   user1Wallet, // payer (Keypair/Payer)
      //   // mintKeypair1.publicKey, // mint
      //   dappTokenManagerV1.mint, // mint
      //   // dappTokenMintV1.address, // mint
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
        mintKeypair1.publicKey, // mint
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
          mintKeypair1.publicKey, // mint
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
    // inside mint_dapp_spl(). Also replaced mintKeypair1.publicKey
    // with dappTokenManagerV1.mint and this was better! The user1TokenAccount
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
        mint: mintKeypair1.publicKey,
        dappTokenManagerV1: dappTokenManagerV1Pda,
        userTokenAccount: user1TokenAccount as anchor.web3.PublicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        // associatedTokenProgram
      })
      // .signers([user1Wallet])
      // .signers([]) // NOTE: dappTokenManagerV1 PDA signs inside program
      .rpc({ skipPreflight: true }); // Get better logs
    console.log("TxHash ::", tx);

    // Fetch updated accounts data
    dappTokenManagerV1 = await program.account.dappTokenManagerV1.fetch(dappTokenManagerV1Pda);

    dappTokenMintV1 = await getMint(
      provider.connection,
      mintKeypair1.publicKey
    );
    console.log('dappTokenMintV1: ', dappTokenMintV1);

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
    const supplyUiAmountStr = (dappTokenMintV1.supply / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString(); // 100
    console.log('supplyUiAmountStr: ', supplyUiAmountStr); // 100
    console.log('Math.pow(10,9): ', Math.pow(10, 9)); // 1000000000 (1 token)
    console.log('BigInt(Math.pow(10,9)): ', BigInt(Math.pow(10, 9))); // 1000000000n
    console.log('dappTokenMintV1.supply.valueOf(): ', dappTokenMintV1.supply.valueOf()); // 100000000000n
    console.log('dappTokenMintV1.supply.toString(): ', dappTokenMintV1.supply.toString()); // 100000000000
    console.log('dappTokenMintV1.supply.valueOf(): ', dappTokenMintV1.supply.toString()); // 100000000000

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

    // - Mint supply should be MINT_AMOUNT 
    expect(
      (dappTokenMintV1.supply / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString()
    ).to.equal(MINT_AMOUNT_UI.toString());
    // - dappTokenManagerV1.totalUserMintCount is 1
    expect(dappTokenManagerV1.totalUserMintCount.toNumber()).to.equal(1);
    // - user1TokenAccountBalance is MINT_AMOUNT
    expect(currentUser1TokenAccountBalance.value.uiAmount).to.equal(MINT_AMOUNT_UI);
    expect((currentUser1TokenAccountInfo.amount / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString()).to.equal(MINT_AMOUNT_UI.toString());
    // - user1TokenAccount.owner should be user1Wallet.pubkey
    expect(currentUser1TokenAccountInfo.owner.toBase58()).to.equal(user1Wallet.publicKey.toBase58())
  })


  // U: Abandoned for version3
  //   it("Create dappTokenManagerV2", async () => {
  //   // Get a mint address
  //   // pub const SEED_PREFIX: &'static str = "dapp-token-manager";

  //   const tx = await program.methods
  //     .initializeDappTokenManagerV2()
  //     .accounts({
  //       // NOTE Still pass mint even though it's not initialized yet
  //       mint: mintKeypair2.publicKey, 
  //       dappTokenManagerV2: dappTokenManagerV2Pda,
  //       authority: wallet.publicKey,
  //     })
  //     // Q: I only sign with wallet, right? I'm not
  //     // creating the Mint (yet), so shouldn't need
  //     // to sign with mintKeypair2
  //     .signers([wallet])
  //     .rpc({ skipPreflight: true }); // Get better logs
  //   console.log("tx:", tx);

  //   // Check that SPL was created and supply minted
  //   dappTokenManagerV2 = await program.account.dappTokenManagerV2.fetch(
  //     dappTokenManagerV2Pda
  //   );
  //   console.log("dappTokenManagerV2: ", dappTokenManagerV2);


  //   expect(dappTokenManagerV2.mint.toBase58()).to.equal(mintKeypair2.publicKey.toBase58());
  //   expect(dappTokenManagerV2.totalUserMintCount.toNumber()).to.equal(0);
  //   expect(dappTokenManagerV2.bump).to.equal(dappTokenManagerBump);
  // });

  xit("Create dappTokenManagerV3 and dappTokenMintV3", async () => {
    // UPDATE: Adding dappTokenMintPersist, so check tests below!
    // Get a mint address
    // pub const SEED_PREFIX: &'static str = "dapp-token-manager-v3";

    const tx = await program.methods
      .initializeDappTokenManagerAndTokenMintV3()
      .accounts({
        mint: mintKeypair3.publicKey,
        dappTokenManagerV3: dappTokenManagerV3Pda,
        authority: wallet.publicKey,
      })
      // NOTE I was right that the mintKeypair3 and wallet are signers,
      // but you don't pass wallet as signer for Anchor. It already knows.
      // Q: With init_if_needed, do I still have mintKeypair3 as signer just in case?
      // A: Yes! init_if_needed is only applied to the user_token_account, not mint or dTM
      .signers([mintKeypair3])
      .rpc({ skipPreflight: true }); // Get better logs
    console.log("tx:", tx);

    // Check that SPL was created and supply minted
    dappTokenManagerV3 = await program.account.dappTokenManagerV3.fetch(
      dappTokenManagerV3Pda
    );
    console.log("dappTokenManagerV3: ", dappTokenManagerV3);

    dappTokenMintV3 = await getMint(provider.connection, dappTokenManagerV3.mint);
    console.log("dappTokenMintV3: ", dappTokenMintV3);

    expect(dappTokenManagerV3.mint.toBase58()).to.equal(mintKeypair3.publicKey.toBase58());
    expect(dappTokenManagerV3.totalUserMintCount.toNumber()).to.equal(0);
    expect(dappTokenManagerV3.bump).to.equal(dappTokenManagerV3Bump);
    expect(dappTokenMintV3.mintAuthority.toBase58()).to.equal(dappTokenManagerV3Pda.toBase58());
    expect(dappTokenMintV3.freezeAuthority.toBase58()).to.equal(dappTokenManagerV3Pda.toBase58());
  });

  xit("Mint dappTokenMintV3 supply to user3TokenAccount (create ATA if needed)", async () => {
    // NOTE Using init_if_needed in validation struct for user_token_account.
    // Q: Do I still need to getAssociatedTokenAddressSync()?
    // My guess is yes, since I need to pass user_token_account in accounts({})
    // A: Yes! Only need to getAssociatedTokenAddressSync(). See 'tokenAccount' in repo:
    // REF: https://github.com/ZYJLiu/token-with-metadata/blob/master/tests/token-with-metadata.ts
    try {
      // NOTE I could do this up top with other globals
      // U: Could refactor this try/catch as well
      user3TokenAccount = getAssociatedTokenAddressSync(
        mintKeypair3.publicKey, // mint
        user3Wallet.publicKey, // owner
      );
      console.log('user3TokenAccount: ', user3TokenAccount);

      const tx = await program.methods
        .mintDappTokenSupplyV3()
        .accounts({
          userTokenAccount: user3TokenAccount,
          mint: mintKeypair3.publicKey,
          dappTokenManagerV3: dappTokenManagerV3Pda,
          user: user3Wallet.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        // Q: Which Signers? Both wallet and mintKeypair?
        // U: With BOTH, I get Error: unknown signer
        // U: With just mintKeypair3, same Error: unknown signer
        // A: Wait! Why pass mintKeypair!? I need ATA, which is
        // getting init_if_needed in program and payer = user, 
        // so I just need user wallet
        .signers([user3Wallet])
        .rpc({ skipPreflight: true }); // Get better logs
      console.log("TxHash ::", tx);
    } catch (err: any) {
      console.log('err: ', err);
    }

    setTimeout(
      async () => { console.log('Waiting for user3TokenAccount to be created...'); },
      3000
    );

    // Transaction was successful up to this point
    // Fetch updated accounts data
    dappTokenManagerV3 = await program.account.dappTokenManagerV3.fetch(dappTokenManagerV3Pda);
    dappTokenMintV3 = await getMint(
      provider.connection,
      mintKeypair3.publicKey
    );
    console.log('dappTokenMintV3: ', dappTokenMintV3);

    const supplyUiAmountStr = (dappTokenMintV3.supply / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString(); // 100
    console.log('supplyUiAmountStr: ', supplyUiAmountStr); // 100
    console.log('Math.pow(10,9): ', Math.pow(10, 9)); // 1000000000 (1 token)
    console.log('BigInt(Math.pow(10,9)): ', BigInt(Math.pow(10, 9))); // 1000000000n
    console.log('dappTokenMintV3.supply.valueOf(): ', dappTokenMintV3.supply.valueOf()); // 100000000000n
    console.log('dappTokenMintV3.supply.toString(): ', dappTokenMintV3.supply.toString()); // 100000000000
    console.log('dappTokenMintV3.supply.valueOf(): ', dappTokenMintV3.supply.toString()); // 100000000000

    const currentUser3TokenAccountBalance = await provider.connection.getTokenAccountBalance(
      user3TokenAccount
    );
    console.log('currentUser3TokenAccountBalance: ', currentUser3TokenAccountBalance);

    const currentUser3TokenAccountInfo = await getAccount(
      provider.connection,
      user3TokenAccount
    )
    console.log('currentUser3TokenAccountInfo.amount.valueOf: ', currentUser3TokenAccountInfo.amount.valueOf()); // 100000000000n
    console.log('currentUser3TokenAccountInfo.amount.toString: ', currentUser3TokenAccountInfo.amount.toString()); // 100000000000

    // - Mint supply should be MINT_AMOUNT 
    expect(
      (dappTokenMintV3.supply / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString()
    ).to.equal(MINT_AMOUNT_UI.toString());
    // - dappTokenManagerV3.totalUserMintCount is 1
    expect(dappTokenManagerV3.totalUserMintCount.toNumber()).to.equal(1);
    // - user3TokenAccountBalance is MINT_AMOUNT
    expect(currentUser3TokenAccountBalance.value.uiAmount).to.equal(MINT_AMOUNT_UI);
    expect((currentUser3TokenAccountInfo.amount / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString()).to.equal(MINT_AMOUNT_UI.toString());
    // - user3TokenAccount.owner should be user3Wallet.pubkey
    expect(currentUser3TokenAccountInfo.owner.toBase58()).to.equal(user3Wallet.publicKey.toBase58())
  });


  xit("AGAIN, Mint dappTokenMintV3 supply to user3TokenAccount (ATA already created)", async () => {
    // NOTE Using init_if_needed in validation struct for user_token_account.
    // Q: Do I still need to getAssociatedTokenAddressSync()?
    // My guess is yes, since I need to pass user_token_account in accounts({})
    // A: Yes! Only need to getAssociatedTokenAddressSync(). See 'tokenAccount' in repo:
    // REF: https://github.com/ZYJLiu/token-with-metadata/blob/master/tests/token-with-metadata.ts
    try {
      // NOTE I could do this up top with other globals
      // U: Could refactor this try/catch as well
      user3TokenAccount = getAssociatedTokenAddressSync(
        mintKeypair3.publicKey, // mint
        user3Wallet.publicKey, // owner
      );
      console.log('user3TokenAccount: ', user3TokenAccount);

      const tx = await program.methods
        .mintDappTokenSupplyV3()
        .accounts({
          userTokenAccount: user3TokenAccount,
          mint: mintKeypair3.publicKey,
          dappTokenManagerV3: dappTokenManagerV3Pda,
          user: user3Wallet.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        // Q: Which Signers? Both wallet and mintKeypair?
        // U: With BOTH, I get Error: unknown signer
        // U: With just mintKeypair3, same Error: unknown signer
        // A: Wait! Why pass mintKeypair!? I need ATA, which is
        // getting init_if_needed in program and payer = user, 
        // so I just need user wallet
        .signers([user3Wallet])
        .rpc({ skipPreflight: true }); // Get better logs
      console.log("TxHash ::", tx);
    } catch (err: any) {
      console.log('err: ', err);
    }

    setTimeout(
      async () => { console.log('Waiting for user3TokenAccount to be created...'); },
      3000
    );

    // Transaction was successful up to this point
    // Fetch updated accounts data
    dappTokenManagerV3 = await program.account.dappTokenManagerV3.fetch(dappTokenManagerV3Pda);
    dappTokenMintV3 = await getMint(
      provider.connection,
      mintKeypair3.publicKey
    );
    console.log('dappTokenMintV3: ', dappTokenMintV3);

    const supplyUiAmountStr = (dappTokenMintV3.supply / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString(); // 100
    console.log('supplyUiAmountStr: ', supplyUiAmountStr); // 100
    console.log('Math.pow(10,9): ', Math.pow(10, 9)); // 1000000000 (1 token)
    console.log('BigInt(Math.pow(10,9)): ', BigInt(Math.pow(10, 9))); // 1000000000n
    console.log('dappTokenMintV3.supply.valueOf(): ', dappTokenMintV3.supply.valueOf()); // 100000000000n
    console.log('dappTokenMintV3.supply.toString(): ', dappTokenMintV3.supply.toString()); // 100000000000
    console.log('dappTokenMintV3.supply.valueOf(): ', dappTokenMintV3.supply.toString()); // 100000000000

    const currentUser3TokenAccountBalance = await provider.connection.getTokenAccountBalance(
      user3TokenAccount
    );
    console.log('currentUser3TokenAccountBalance: ', currentUser3TokenAccountBalance);

    const currentUser3TokenAccountInfo = await getAccount(
      provider.connection,
      user3TokenAccount
    )
    console.log('currentUser3TokenAccountInfo.amount.valueOf: ', currentUser3TokenAccountInfo.amount.valueOf()); // 100000000000n
    console.log('currentUser3TokenAccountInfo.amount.toString: ', currentUser3TokenAccountInfo.amount.toString()); // 100000000000

    // - Mint supply should be MINT_AMOUNT 
    expect(
      (dappTokenMintV3.supply / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString()
    ).to.equal((MINT_AMOUNT_UI * 2).toString());
    // - dappTokenManagerV3.totalUserMintCount is 2
    expect(dappTokenManagerV3.totalUserMintCount.toNumber()).to.equal(2);
    // - user3TokenAccountBalance is MINT_AMOUNT
    expect(currentUser3TokenAccountBalance.value.uiAmount).to.equal(MINT_AMOUNT_UI * 2);
    expect((currentUser3TokenAccountInfo.amount / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString()).to.equal((MINT_AMOUNT_UI * 2).toString());
    // - user3TokenAccount.owner should be user3Wallet.pubkey
    expect(currentUser3TokenAccountInfo.owner.toBase58()).to.equal(user3Wallet.publicKey.toBase58())
  });


  it("Create dappTokenManagerV3 and dappTokenMintPersist", async () => {
    // UPDATE: Adding dappTokenMintPersist, so check tests below!
    // Get a mint address
    // pub const SEED_PREFIX: &'static str = "dapp-token-manager-v3";

    const tx = await program.methods
      .initializeDappTokenManagerAndTokenMintV3()
      .accounts({
        mint: dappTokenMintPersistKeypair.publicKey,
        dappTokenManagerV3: dappTokenManagerV3Pda,
        authority: wallet.publicKey, // my local config wallet
      })
      // NOTE I was right that the dappTokenMintPersistKeypair and wallet are signers,
      // but you don't pass wallet as signer for Anchor. It already knows.
      // Q: With init_if_needed, do I still have mintKeypair3 as signer just in case?
      // A: Yes! init_if_needed is only applied to the user_token_account, not mint or dTM
      .signers([dappTokenMintPersistKeypair])
      .rpc({ skipPreflight: true }); // Get better logs
    console.log("tx:", tx);

    // Check that SPL was created and supply minted
    dappTokenManagerV3 = await program.account.dappTokenManagerV3.fetch(
      dappTokenManagerV3Pda
    );
    console.log("dappTokenManagerV3: ", dappTokenManagerV3);

    dappTokenMintPersist = await getMint(provider.connection, dappTokenManagerV3.mint);
    console.log("dappTokenMintPersist: ", dappTokenMintPersist);

    expect(dappTokenManagerV3.mint.toBase58()).to.equal(dappTokenMintPersistKeypair.publicKey.toBase58());
    expect(dappTokenManagerV3.totalUserMintCount.toNumber()).to.equal(0);
    expect(dappTokenManagerV3.bump).to.equal(dappTokenManagerV3Bump);
    expect(dappTokenMintPersist.mintAuthority.toBase58()).to.equal(dappTokenManagerV3Pda.toBase58());
    expect(dappTokenMintPersist.freezeAuthority.toBase58()).to.equal(dappTokenManagerV3Pda.toBase58());
  });

  it("Mint dappTokenMintV3 supply to user4TokenAccount (create ATA if needed)", async () => {
    // NOTE Using init_if_needed in validation struct for user_token_account.
    // Q: Do I still need to getAssociatedTokenAddressSync()?
    // My guess is yes, since I need to pass user_token_account in accounts({})
    // A: YES! But only need to getAssociatedTokenAddressSync(). See 'tokenAccount' in repo:
    // REF: https://github.com/ZYJLiu/token-with-metadata/blob/master/tests/token-with-metadata.ts
    try {
      // NOTE I could do this up top with other globals
      // U: Could refactor this try/catch as well
      user4TokenAccount = getAssociatedTokenAddressSync(
        dappTokenMintPersistKeypair.publicKey, // mint
        user4Wallet.publicKey, // owner
      );
      console.log('user4TokenAccount: ', user4TokenAccount);

      const tx = await program.methods
        .mintDappTokenSupplyV3()
        .accounts({
          userTokenAccount: user4TokenAccount,
          mint: dappTokenMintPersistKeypair.publicKey,
          dappTokenManagerV3: dappTokenManagerV3Pda,
          user: user4Wallet.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        // Q: Which Signers? Both wallet and mintKeypair?
        // U: With BOTH, I get Error: unknown signer
        // U: With just mintKeypair3, same Error: unknown signer
        // A: Wait! Why pass mintKeypair!? I need ATA, which is
        // getting init_if_needed in program and payer = user, 
        // so I just need USER WALLET!
        .signers([user4Wallet])
        .rpc({ skipPreflight: true }); // Get better logs
      console.log("TxHash ::", tx);
    } catch (err: any) {
      console.log('err: ', err);
    }

    setTimeout(
      async () => { console.log('Waiting for user4TokenAccount to be created...'); },
      3000
    );

    // Transaction was successful up to this point
    // Fetch updated accounts data
    dappTokenManagerV3 = await program.account.dappTokenManagerV3.fetch(dappTokenManagerV3Pda);
    dappTokenMintPersist = await getMint(
      provider.connection,
      dappTokenMintPersistKeypair.publicKey
    );
    console.log('dappTokenMintPersist: ', dappTokenMintPersist);

    const supplyUiAmountStr = (dappTokenMintPersist.supply / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString(); // 100
    // console.log('supplyUiAmountStr: ', supplyUiAmountStr); // 100
    // console.log('Math.pow(10,9): ', Math.pow(10, 9)); // 1000000000 (1 token)
    // console.log('BigInt(Math.pow(10,9)): ', BigInt(Math.pow(10, 9))); // 1000000000n
    console.log('dappTokenMintPersist.supply.valueOf(): ', dappTokenMintPersist.supply.valueOf()); // 100000000000n
    console.log('dappTokenMintPersist.supply.toString(): ',dappTokenMintPersist.supply.toString()); // 100000000000
    console.log('dappTokenMintPersist.supply.valueOf(): ', dappTokenMintPersist.supply.toString()); // 100000000000

    const currentUser4TokenAccountBalance = await provider.connection.getTokenAccountBalance(
      user4TokenAccount
    );
    console.log('currentUser4TokenAccountBalance: ', currentUser4TokenAccountBalance);

    const currentUser4TokenAccountInfo = await getAccount(
      provider.connection,
      user4TokenAccount
    )
    console.log('currentUser4TokenAccountInfo.amount.valueOf: ', currentUser4TokenAccountInfo.amount.valueOf()); // 100000000000n
    console.log('currentUser4TokenAccountInfo.amount.toString: ', currentUser4TokenAccountInfo.amount.toString()); // 100000000000

    // - Mint supply should be MINT_AMOUNT 
    expect(
      (dappTokenMintPersist.supply / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString()
    ).to.equal(MINT_AMOUNT_UI.toString());
    // - dappTokenManagerV3.totalUserMintCount is 1
    expect(dappTokenManagerV3.totalUserMintCount.toNumber()).to.equal(1);
    // - user3TokenAccountBalance is MINT_AMOUNT
    expect(currentUser4TokenAccountBalance.value.uiAmount).to.equal(MINT_AMOUNT_UI);
    expect((currentUser4TokenAccountInfo.amount / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString()).to.equal(MINT_AMOUNT_UI.toString());
    // - user4TokenAccount.owner should be user4Wallet.pubkey
    expect(currentUser4TokenAccountInfo.owner.toBase58()).to.equal(user4Wallet.publicKey.toBase58())
  });


  it("AGAIN, Mint dappTokenMintV3 supply to user4TokenAccount (ATA already created)", async () => {
    // NOTE Using init_if_needed in validation struct for user_token_account.
    // Q: Do I still need to getAssociatedTokenAddressSync()?
    // My guess is yes, since I need to pass user_token_account in accounts({})
    // A: Yes! Only need to getAssociatedTokenAddressSync(). See 'tokenAccount' in repo:
    // REF: https://github.com/ZYJLiu/token-with-metadata/blob/master/tests/token-with-metadata.ts
    try {
      // NOTE I could do this up top with other globals
      // U: Could refactor this try/catch as well
      user4TokenAccount = getAssociatedTokenAddressSync(
        dappTokenMintPersistKeypair.publicKey, // mint
        user4Wallet.publicKey, // owner
      );
      console.log('user4TokenAccount: ', user4TokenAccount);

      const tx = await program.methods
        .mintDappTokenSupplyV3()
        .accounts({
          userTokenAccount: user4TokenAccount,
          mint: dappTokenMintPersistKeypair.publicKey,
          dappTokenManagerV3: dappTokenManagerV3Pda,
          user: user4Wallet.publicKey,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        // Q: Which Signers? Both wallet and mintKeypair?
        // U: With BOTH, I get Error: unknown signer
        // U: With just mintKeypair4, same Error: unknown signer
        // A: Wait! Why pass mintKeypair!? I need ATA, which is
        // getting init_if_needed in program and payer = user, 
        // so I just need user wallet
        .signers([user4Wallet])
        .rpc({ skipPreflight: true }); // Get better logs
      console.log("TxHash ::", tx);
    } catch (err: any) {
      console.log('err: ', err);
    }

    setTimeout(
      async () => { console.log('Waiting for user4TokenAccount to be created...'); },
      3000
    );

    // Transaction was successful up to this point
    // Fetch updated accounts data
    dappTokenManagerV3 = await program.account.dappTokenManagerV3.fetch(dappTokenManagerV3Pda);
    dappTokenMintPersist = await getMint(
      provider.connection,
      dappTokenMintPersistKeypair.publicKey
    );
    console.log('dappTokenMintPersist: ', dappTokenMintPersist);

    const supplyUiAmountStr = (dappTokenMintPersist.supply / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString(); // 200
    console.log('supplyUiAmountStr: ', supplyUiAmountStr); // 200
    // console.log('Math.pow(10,9): ', Math.pow(10, 9)); // 1000000000 (1 token)
    // console.log('BigInt(Math.pow(10,9)): ', BigInt(Math.pow(10, 9))); // 1000000000n
    console.log('dappTokenMintPersist.supply.valueOf(): ', dappTokenMintPersist.supply.valueOf()); // 200000000000n
    console.log('dappTokenMintPersist.supply.toString(): ', dappTokenMintPersist.supply.toString()); // 200000000000
    console.log('dappTokenMintPersist.supply.valueOf(): ', dappTokenMintPersist.supply.toString()); // 200000000000

    const currentUser4TokenAccountBalance = await provider.connection.getTokenAccountBalance(
      user4TokenAccount
    );
    console.log('currentUser4TokenAccountBalance: ', currentUser4TokenAccountBalance);

    const currentUser4TokenAccountInfo = await getAccount(
      provider.connection,
      user4TokenAccount
    )
    console.log('currentUser4TokenAccountInfo.amount.valueOf: ', currentUser4TokenAccountInfo.amount.valueOf()); // 200000000000n
    console.log('currentUser4TokenAccountInfo.amount.toString: ', currentUser4TokenAccountInfo.amount.toString()); // 200000000000

    // - Mint supply should be MINT_AMOUNT 
    expect(
      (dappTokenMintPersist.supply / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString()
    ).to.equal((MINT_AMOUNT_UI * 2).toString());
    // - dappTokenManagerV3.totalUserMintCount is 2
    expect(dappTokenManagerV3.totalUserMintCount.toNumber()).to.equal(2);
    // - user4TokenAccountBalance is MINT_AMOUNT
    expect(currentUser4TokenAccountBalance.value.uiAmount).to.equal(MINT_AMOUNT_UI * 2);
    expect((currentUser4TokenAccountInfo.amount / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString()).to.equal((MINT_AMOUNT_UI * 2).toString());
    // - user4TokenAccount.owner should be user4Wallet.pubkey
    expect(currentUser4TokenAccountInfo.owner.toBase58()).to.equal(user4Wallet.publicKey.toBase58())
  });


});

