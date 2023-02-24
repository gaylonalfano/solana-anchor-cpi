import * as anchor from "@project-serum/anchor";
import { getMint, getOrCreateAssociatedTokenAccount, Mint } from "@solana/spl-token";
import { expect } from "chai";
import { CustomSplToken } from "../target/types/custom_spl_token";
// import fs from "mz/fs";

// TIL:
// - Need globals for dappTokenManager, dappTokenMint

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

  // Create a couple user wallets to test with
  const user1Wallet = anchor.web3.Keypair.generate();
  const user2Wallet = anchor.web3.Keypair.generate();
  let user1TokenAccount;
  let user2TokenAccount;

  // U: Testing out updated initializeDappSpl instruction
  before(async () => {

    // 1. Ensure our wallets have SOL
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        user1Wallet.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
      )
    );
    console.log(
      `user1Wallet balance: ${await provider.connection.getBalance(user1Wallet.publicKey)}`
    );

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        user2Wallet.publicKey,
        anchor.web3.LAMPORTS_PER_SOL
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
    user1TokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      user1Wallet, // payer (Keypair/Payer)
      mintKeypair.publicKey, // mint
      user1Wallet.publicKey, // owner
    );
    console.log('user1TokenAccount: ', user1TokenAccount);

    const tx = await program.methods
      .mintDappSpl()
      .accounts({
        user: user1Wallet.publicKey,
        mint: mintKeypair.publicKey,
        dappTokenManager: dappTokenManagerPda,
        userTokenAccount: user1TokenAccount,
        // tokenProgram: TOKEN_PROGRAM_ID,
        // associatedTokenProgram
      })
      .signers([user1Wallet])
      .rpc({ skipPreflight: true }); // Get better logs
    console.log("TxHash ::", tx);

    // Fetch updated accounts data
    dappTokenManager = await program.account.dappTokenManager.fetch(dappTokenManagerPda);

    dappTokenMint = await getMint(
      provider.connection,
      mintKeypair.publicKey
    );
    console.log('dappTokenMint: ', dappTokenMint);

    const currentUser1TokenAccountBalance = await provider.connection.getTokenAccountBalance(
      user1TokenAccount
    );
    console.log('currentUser1TokenAccountBalance: ', currentUser1TokenAccountBalance);



    // TODO Assertions
    // - Mint supply should be 100K (each mint is 100K to wallet)
    // - dappTokenManager.totalUserMintCount is 1
    // - user1TokenAccountBalance is 100K
    // - user1TokenAccount.owner should be user1Wallet.pubkey
  })

});

