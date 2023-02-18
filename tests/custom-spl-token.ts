import * as anchor from "@project-serum/anchor";
import { expect } from "chai";
import { CustomSplToken } from "../target/types/custom_spl_token";
// import fs from "mz/fs";


// UPDATE: Found out thanks to Joe that a program-specific SPL token isn't
// that complicated after all. I just need to create a PDA between the
// program and the mint, and then set the mint.authority = PDA. Then I
// can mintToChecked() by signing the 'mint' CPI to Token Program, 
// by using the PDA's seeds!

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

  it("Create SPL Mint", async () => {
    const mintKeypair: anchor.web3.Keypair = anchor.web3.Keypair.generate();
    const tokenAccountAddress = await anchor.utils.token.associatedAddress({
      mint: mintKeypair.publicKey,
      owner: wallet.publicKey,
    });
    console.log(`New token (mint): ${mintKeypair.publicKey}`);

    // 2. Transact with the mint_nft() fn in our on-chain program
    // NOTE This sends and confirms the transaction in one go!
    // FIXME: Encountered two errors when running anchor test:
    // -- One about metadata not being added correctly or at all
    // -- Two was the familiar ix error: instruction modified the
    // UPDATE: Turns out was running older version of Solana program CLI!
    // program ID of an account. In the past, this was space/size related...
    // NOTE You DO NOT pass the Context as an arg! Anchor does this automatically!
    await program.methods
      .initializeSpl()
      // NOTE We only provide the PublicKeys for all the accounts.
      // We do NOT have to deal with isSigner, isWritable, etc. like in RAW
      // since we already declared that in the program Context struct.
      // This means Anchor will look for all that info in our struct
      // ON ENTRY!
      // NOTE We also don't have to pass the System Program, Token Program, and
      // Associated Token Program, since Anchor resolves these automatically. 
      .accounts({
        mint: mintKeypair.publicKey,
        tokenAccount: tokenAccountAddress,
        mintAuthority: wallet.publicKey,
      })
      // NOTE I was right that the mintKeypair and wallet are signers,
      // but you don't pass wallet as signer for Anchor. It already knows.
      .signers([mintKeypair])
      .rpc({ skipPreflight: true }); // Get better logs

    // Check that SPL was created, ATA created, and supply minted
    const walletTokenAccountInfo = await provider.connection.getTokenAccountBalance(
      tokenAccountAddress
    )
    // console.log(walletTokenAccountInfo); // { context: {}, value: {} }
    expect(parseInt(walletTokenAccountInfo.value.amount)).to.equal(1);
  });

});

