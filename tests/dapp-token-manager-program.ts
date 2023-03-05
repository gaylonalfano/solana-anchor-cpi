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
import { DappTokenManagerProgram } from "../target/types/dapp_token_manager_program";
import { MasterProgram } from "../target/types/master_program";
import { createKeypairFromFile } from "./utils";

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
// - CPI: I will still use dappTokenManagerProgram to create
//   the DTM, but I assign the Caller Program PDA as the DTM.authority!
//   Then (I think), I just need to build the IX to CPI invoke
//   the mintDappTokenSupply() from inside Caller Program (Master Program)


// Q: Not sure if this is right. The caller program is going to
// invoke my DTMP program to create a new DTM for the caller program,
// which it can then use to manage its own mint. 
// Example Scenario: My Ledger Program (caller) uses CPI to invoke
// this DTMP program. But how/where does it invoke this? And how
// will it pay? I know I need to build a custom IX handler inside
// the caller program and enable CPI in Anchor.toml...
// U: I've reworked my Instructions and State. The caller can pass
// 'authority' as IX data, and there's now an 'authority_payer' field
// on the DTM struct.
//
const ONE_TOKEN_AMOUNT_RAW = 1000000000;
const MINT_AMOUNT_RAW = ONE_TOKEN_AMOUNT_RAW * 100; // 100 full tokens
const MINT_AMOUNT_UI = 100; // 100 full tokens


describe("dapp-token-manager-program", () => {

  const provider = anchor.AnchorProvider.env();
  // NOTE We use anchor.Wallet to help with typing
  const wallet = provider.wallet as anchor.Wallet;
  anchor.setProvider(provider);

  // Get BOTH Programs (caller (master) and callee (dtmp))
  const dappTokenManagerProgram = anchor.workspace
    .DappTokenManagerProgram as anchor.Program<DappTokenManagerProgram>;
  const masterProgram = anchor.workspace.MasterProgram as anchor.Program<MasterProgram>;

  // Created a new JSON Keypair file using CLI
  const dappTokenMintString = "DtmDGVRW6C2zfVuXKtvt7P4FLrg3o52zg64bQe8MJ8i7";
  const dappTokenMintPubkey = new anchor.web3.PublicKey(dappTokenMintString);
  let dappTokenMintKeypair: anchor.web3.Keypair;
  let dappTokenMint: Mint;
  let dappTokenManager: anchor.IdlAccounts<DappTokenManagerProgram>['dappTokenManager'];

  // Q: Not sure if this is right. The caller program is going to
  // invoke my DTMP program to create a new DTM for the caller program,
  // which it can then use to manage its own mint. 
  // Example Scenario: My Ledger Program (caller) uses CPI to invoke
  // this DTMP program. But how/where does it invoke this? And how
  // will it pay? I know I need to build a custom IX handler inside
  // the caller program and enable CPI in Anchor.toml...
  // U: I've reworked my Instructions and State. The caller can pass
  // 'authority' as IX data, and there's now an 'authority_payer' field
  // on the DTM struct. 
  const authorityPayer = anchor.web3.Keypair.generate();
  console.log("authorityPayer: ", authorityPayer.publicKey.toBase58())

  // NOTE If Caller wants 'authority' to be PDA, then we need to derive.
  // Q: If 'authority' is PDA, should I save 'authorityBump' anywhere?
  // Like, should I add a 'authority_bump' field in DTM struct? My thinking
  // is that when Caller invokes mintDappTokenSupply() method, may need
  // this bump...
  const [authorityPda, authorityBump] = anchor.utils.publicKey.findProgramAddressSync(
    [],
    masterProgram.programId
  )
  // NOTE If Caller wants 'authority' to be KEYPAIR, then need to generate.
  const authorityKeypair = anchor.web3.Keypair.generate();

  // Derive the DTM PDA using caller program and caller
  const [dappTokenManagerPda, dappTokenManagerBump] = anchor.utils.publicKey.findProgramAddressSync(
    [
      Buffer.from("dapp-token-manager"),
      dappTokenMintPubkey.toBuffer(),
      authorityPda.toBuffer(), // <-- PDA
    ],
    dappTokenManagerProgram.programId
  );


  // Random user wanting to mint new supply
  const user1Wallet = anchor.web3.Keypair.generate();
  console.log("user1Wallet: ", user1Wallet.publicKey.toBase58())
  let user1TokenAccount: anchor.web3.PublicKey;

  before(async () => {
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        authorityPayer.publicKey,
        anchor.web3.LAMPORTS_PER_SOL * 2
      )
    );
    console.log(
      `authorityPayer balance: ${await provider.connection.getBalance(authorityPayer.publicKey)}`
    );

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        user1Wallet.publicKey,
        anchor.web3.LAMPORTS_PER_SOL * 2
      )
    );
    console.log(
      `user1Wallet balance: ${await provider.connection.getBalance(user1Wallet.publicKey)}`
    );

    // 2. Create the PERSISTING dApp Token Mint
    // Persistant Token (instead of temp Keypairs)
    // Let's create our Keypair from the keypair file
    // console.log('__dirname:', __dirname);
    dappTokenMintKeypair = await createKeypairFromFile(
      __dirname + `/keypairs/${dappTokenMintString}.json`
    );
    // console.log("dappTokenMintPersistKeypair: ", dappTokenMintPersistKeypair);
    console.log("dappTokenMintKeypair.publicKey: ", dappTokenMintKeypair.publicKey);

  });

  it("Create dappTokenManager and dappTokenMint", async () => {
    // IMPORTANT: Once deployed I no longer need
    // to run this code ever again! 

    // NOTE: If 'authority' is going to be a PDA from Caller,
    // then I need to derive it from masterProgram. If 'authority' is a
    // Keypair, then I need to pass it instead
    const tx = await dappTokenManagerProgram.methods
      .createDappTokenManager(
        authorityPda,
        new anchor.BN(MINT_AMOUNT_RAW)
      )
      .accounts({
        mint: dappTokenMintKeypair.publicKey,
        dappTokenManager: dappTokenManagerPda,
        authorityPayer: authorityPayer.publicKey,
      })
      // NOTE I was right that the dappTokenMintPersistKeypair and wallet are signers,
      // but you don't pass wallet as signer for Anchor. It already knows.
      // U: I've added 'authority_payer: Signer' in Accounts struct
      // Q: How do I specify a different wallet as a Signer, rather than
      // the Anchor default provider.wallet? Do I just pass authorityPayer?
      .signers([dappTokenMintKeypair, authorityPayer])
      .rpc({ skipPreflight: true }); // Get better logs
    console.log("tx:", tx);

    dappTokenManager = await dappTokenManagerProgram.account.dappTokenManager.fetch(
      dappTokenManagerPda
    );
    console.log("dappTokenManager: ", dappTokenManager);

    dappTokenMint = await getMint(provider.connection, dappTokenManager.mint);
    console.log("dappTokenMint: ", dappTokenMint);

    expect(dappTokenManager.mint.toBase58()).to.equal(dappTokenMintKeypair.publicKey.toBase58());
    expect(dappTokenManager.totalMintCount.toNumber()).to.equal(0);
    expect(dappTokenManager.bump).to.equal(dappTokenManagerBump);
    expect(dappTokenMint.mintAuthority.toBase58()).to.equal(dappTokenManagerPda.toBase58());
    expect(dappTokenMint.freezeAuthority.toBase58()).to.equal(dappTokenManagerPda.toBase58());
  });

  it("Mint dappTokenMint supply to user1TokenAccount (create ATA if needed)", async () => {
    // NOTE Using init_if_needed in validation struct for user_token_account.
    // Q: Do I still need to getAssociatedTokenAddressSync()?
    // My guess is yes, since I need to pass user_token_account in accounts({})
    // A: YES! But only need to getAssociatedTokenAddressSync(). See 'tokenAccount' in repo:
    // REF: https://github.com/ZYJLiu/token-with-metadata/blob/master/tests/token-with-metadata.ts
    try {
      // NOTE I could do this up top with other globals
      // U: Could refactor this try/catch as well
      user1TokenAccount = getAssociatedTokenAddressSync(
        dappTokenMintKeypair.publicKey, // mint
        user1Wallet.publicKey, // owner
      );
      console.log('user1TokenAccount: ', user1TokenAccount);

      // Q: FIXME Why am I getting Privilege Escalation errors?
      // A: Turns out I forgot the 'bump' seed in my IX handler!
      // Specifically, it's because my mintDappTokenSupply instruction
      // is making a CPI (to Token MintTo{}), but the Signer it 
      // (Token Program) receives is not what it expects. 
      const tx = await dappTokenManagerProgram.methods
        .mintDappTokenSupply()
        .accounts({
          userTokenAccount: user1TokenAccount,
          mint: dappTokenMintKeypair.publicKey,
          dappTokenManager: dappTokenManagerPda,
          user: user1Wallet.publicKey,
          // authority: authorityPda, // U: Not sure I need this.
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        // Q: Which Signers? Both wallet and mintKeypair?
        // A: Wait! Why pass mintKeypair!? I need ATA, which is
        // getting init_if_needed in program and payer = user, 
        // so I just need USER WALLET!
        // U/Q: Added 'authority: Signer' which is Caller Program PDA
        // Does it need to be a Signer? Even necessary to add it?
        // U: Removed for now since MintTo just needs DTM PDA to sign...
        .signers([user1Wallet])
        .rpc({ skipPreflight: true }); // Get better logs
      console.log("TxHash ::", tx);
    } catch (err: any) {
      console.log('err: ', err);
    }

    setTimeout(
      async () => { console.log('Waiting for user1TokenAccount to be created...'); },
      3000
    );

    // Transaction was successful up to this point
    // Fetch updated accounts data
    dappTokenManager = await dappTokenManagerProgram.account.dappTokenManager.fetch(dappTokenManagerPda);
    dappTokenMint = await getMint(
      provider.connection,
      dappTokenMintKeypair.publicKey
    );
    console.log('dappTokenMint: ', dappTokenMint);

    const supplyUiAmountStr = (dappTokenMint.supply / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString(); // 100
    // console.log('supplyUiAmountStr: ', supplyUiAmountStr); // 100
    // console.log('Math.pow(10,9): ', Math.pow(10, 9)); // 1000000000 (1 token)
    // console.log('BigInt(Math.pow(10,9)): ', BigInt(Math.pow(10, 9))); // 1000000000n
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

    // - Mint supply should be MINT_AMOUNT 
    expect(
      (dappTokenMint.supply / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString()
    ).to.equal(MINT_AMOUNT_UI.toString());
    // - dappTokenManager.totalMintCount is 1
    expect(dappTokenManager.totalMintCount.toNumber()).to.equal(1);
    // - user1TokenAccountBalance is MINT_AMOUNT
    expect(currentUser1TokenAccountBalance.value.uiAmount).to.equal(MINT_AMOUNT_UI);
    expect((currentUser1TokenAccountInfo.amount / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString()).to.equal(MINT_AMOUNT_UI.toString());
    // - user1TokenAccount.owner should be user1Wallet.pubkey
    expect(currentUser1TokenAccountInfo.owner.toBase58()).to.equal(user1Wallet.publicKey.toBase58())
  });


  it("AGAIN: Mint dappTokenMint supply to user1TokenAccount (ATA already created)", async () => {
    // NOTE Using init_if_needed in validation struct for user_token_account.
    // Q: Do I still need to getAssociatedTokenAddressSync()?
    // My guess is yes, since I need to pass user_token_account in accounts({})
    // A: YES! But only need to getAssociatedTokenAddressSync(). See 'tokenAccount' in repo:
    // REF: https://github.com/ZYJLiu/token-with-metadata/blob/master/tests/token-with-metadata.ts
    try {
      // NOTE I could do this up top with other globals
      // U: Could refactor this try/catch as well
      user1TokenAccount = getAssociatedTokenAddressSync(
        dappTokenMintKeypair.publicKey, // mint
        user1Wallet.publicKey, // owner
      );
      console.log('user1TokenAccount: ', user1TokenAccount);

      // Q: FIXME Why am I getting Privilege Escalation errors?
      // A: Turns out I forgot the 'bump' seed in my IX handler!
      // Specifically, it's because my mintDappTokenSupply instruction
      // is making a CPI (to Token MintTo{}), but the Signer it 
      // (Token Program) receives is not what it expects. 
      const tx = await dappTokenManagerProgram.methods
        .mintDappTokenSupply()
        .accounts({
          userTokenAccount: user1TokenAccount,
          mint: dappTokenMintKeypair.publicKey,
          dappTokenManager: dappTokenManagerPda,
          user: user1Wallet.publicKey,
          // authority: authorityPda, // U: Not sure I need this.
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        // Q: Which Signers? Both wallet and mintKeypair?
        // A: Wait! Why pass mintKeypair!? I need ATA, which is
        // getting init_if_needed in program and payer = user, 
        // so I just need USER WALLET!
        // U/Q: Added 'authority: Signer' which is Caller Program PDA
        // Does it need to be a Signer? Even necessary to add it?
        // U: Removed for now since MintTo just needs DTM PDA to sign...
        .signers([user1Wallet])
        .rpc({ skipPreflight: true }); // Get better logs
      console.log("TxHash ::", tx);
    } catch (err: any) {
      console.log('err: ', err);
    }

    setTimeout(
      async () => { console.log('Waiting for user1TokenAccount to be created...'); },
      3000
    );

    // Transaction was successful up to this point
    // Fetch updated accounts data
    dappTokenManager = await dappTokenManagerProgram.account.dappTokenManager.fetch(dappTokenManagerPda);
    dappTokenMint = await getMint(
      provider.connection,
      dappTokenMintKeypair.publicKey
    );
    console.log('dappTokenMint: ', dappTokenMint);

    const supplyUiAmountStr = (dappTokenMint.supply / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString(); // 200
    console.log('supplyUiAmountStr: ', supplyUiAmountStr); // 200
    // console.log('Math.pow(10,9): ', Math.pow(10, 9)); // 1000000000 (1 token)
    // console.log('BigInt(Math.pow(10,9)): ', BigInt(Math.pow(10, 9))); // 2000000000n
    console.log('dappTokenMint.supply.valueOf(): ', dappTokenMint.supply.valueOf()); // 200000000000n
    console.log('dappTokenMint.supply.toString(): ', dappTokenMint.supply.toString()); // 200000000000
    console.log('dappTokenMint.supply.valueOf(): ', dappTokenMint.supply.toString()); // 200000000000

    const currentUser1TokenAccountBalance = await provider.connection.getTokenAccountBalance(
      user1TokenAccount
    );
    console.log('currentUser1TokenAccountBalance: ', currentUser1TokenAccountBalance);

    const currentUser1TokenAccountInfo = await getAccount(
      provider.connection,
      user1TokenAccount
    )
    console.log('currentUser1TokenAccountInfo.amount.valueOf: ', currentUser1TokenAccountInfo.amount.valueOf()); // 200000000000n
    console.log('currentUser1TokenAccountInfo.amount.toString: ', currentUser1TokenAccountInfo.amount.toString()); // 200000000000

    // - Mint supply should be MINT_AMOUNT 
    expect(
      (dappTokenMint.supply / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString()
    ).to.equal((MINT_AMOUNT_UI * 2).toString());
    // - dappTokenManager.totalMintCount is 2
    expect(dappTokenManager.totalMintCount.toNumber()).to.equal(2);
    // - user1TokenAccountBalance is MINT_AMOUNT
    expect(currentUser1TokenAccountBalance.value.uiAmount).to.equal(MINT_AMOUNT_UI * 2);
    expect((currentUser1TokenAccountInfo.amount / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString()).to.equal((MINT_AMOUNT_UI * 2).toString());
    // - user1TokenAccount.owner should be user1Wallet.pubkey
    expect(currentUser1TokenAccountInfo.owner.toBase58()).to.equal(user1Wallet.publicKey.toBase58())
  });



});
