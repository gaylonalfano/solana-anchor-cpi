import * as anchor from "@project-serum/anchor";
import { getMint, setAuthority, TOKEN_PROGRAM_ID, AuthorityType, createSetAuthorityInstruction } from "@solana/spl-token";
import { expect } from "chai";
import { CustomSplToken } from "../target/types/custom_spl_token";
// import fs from "mz/fs";


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

  // U: Testing out updated initializeDappSpl instruction
  // before(async () => {
  //   // Setup the dApp Token
  //   // UPDATE: Found out thanks to Joe that a program-specific SPL token isn't
  //   // that complicated after all. I just need to create a PDA between the
  //   // program and the mint, and then set the mint.authority = PDA. Then I
  //   // can mintToChecked() by signing the 'mint' CPI to Token Program, 
  //   // by using the PDA's seeds!
  //   // Following Joe's advice:
  //   // 1. Need a PDA between Mint and Program
  //   // 1.1 Create the Mint to get its address
  //   // NOTE: spl-token create-token (paid with my wallet)
  //   const MINT_ADDRESS = new anchor.web3.PublicKey("ANkycvSnegdXy4sBBqDjXb5eW1p8qRTzvKhHtX8NTTP9");
  //   // 1.2 Create the PDA
  //   const CUSTOM_SPL_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("cPshoEnza1TMdWGRkQyiQQqu34iMDTc7i3XT8uVVfjp");
  //   let DAPP_TOKEN_PDA: anchor.web3.PublicKey;
  //   let DAPP_TOKEN_BUMP: number;

  //   function getDappTokenPdaAndBump() {
  //     // Derive the PDA address
  //     [DAPP_TOKEN_PDA, DAPP_TOKEN_BUMP] = anchor.utils.publicKey.findProgramAddressSync(
  //       [
  //         MINT_ADDRESS.toBuffer(),
  //         CUSTOM_SPL_TOKEN_PROGRAM_ID.toBuffer()
  //       ],
  //       CUSTOM_SPL_TOKEN_PROGRAM_ID
  //     )
  //   }

  //   getDappTokenPdaAndBump();

  //   // 2. Make PDA the mint authority
  //   // NOTE setAuthority() won't work since Wallet != Signer.
  //   // Need to manually build the tx
  //   async function setMintAuthority() {
  //     // NOTE: New Versioned Transaction approach
  //     // REF: https://docs.solana.com/developing/versioned-transactions
  //     let minRent = await provider.connection.getMinimumBalanceForRentExemption(0);
  //     const latestBlockhash = await provider.connection.getLatestBlockhash();

  //     let ix = createSetAuthorityInstruction(
  //       MINT_ADDRESS, // mint account
  //       null, // current auth
  //       AuthorityType.MintTokens, // authority type
  //       DAPP_TOKEN_PDA // new authority
  //     );
  //     const instructions = [
  //       ix,
  //     ];

  //     const messageV0 = new anchor.web3.TransactionMessage({
  //       payerKey: wallet.publicKey,
  //       recentBlockhash: latestBlockhash.blockhash,
  //       instructions,
  //     }).compileToV0Message();
  //     console.log('messageV0: ', messageV0);

  //     const tx = new anchor.web3.VersionedTransaction(messageV0);
  //     // Sign the transaction with required 'Signers'
  //     tx.sign([wallet.payer]);

  //     // Send our v0 transaction to the cluster
  //     const txid = await provider.connection.sendTransaction(tx);
  //     console.log(`https://explorer.solana.com/tx/${txid}?cluster=devnet`);
  //   }

  //   // Now use the new setAuthority function
  //   await setMintAuthority();


  // })


  it("Create SPL Mint", async () => {
    // Get a mint address
    // pub const SEED_PREFIX: &'static str = "dapp-token-manager";

    const mintKeypair: anchor.web3.Keypair = anchor.web3.Keypair.generate();
    console.log(`New token (mint): ${mintKeypair.publicKey}`);

    // Derive a PDA
    const [dappTokenManagerPda, dappTokenManagerBump] = anchor.utils.publicKey.findProgramAddressSync(
      [
        Buffer.from("dapp-token-manager"),
        mintKeypair.publicKey.toBuffer(),
      ],
      program.programId
    )

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

    // Check that SPL was created, ATA created, and supply minted
    const dappTokenManager = await program.account.dappTokenManager.fetch(
      dappTokenManagerPda
    );
    console.log("dappTokenManager: ", dappTokenManager);
    
    // const dappSplMint = await ancho

    // console.log(walletTokenAccountInfo); // { context: {}, value: {} }
    // expect(parseInt(walletTokenAccountInfo.value.amount)).to.equal(1);
  });

});

