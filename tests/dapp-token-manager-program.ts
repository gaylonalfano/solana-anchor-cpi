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


// Q: Not sure if this is right. The caller program is going to
// invoke my DTMP program to create a new DTM for the caller program,
// which it can then use to manage its own mint. 
// Example Scenario: My Ledger Program (caller) uses CPI to invoke
// this DTMP program. But how/where does it invoke this? And how
// will it pay? I know I need to build a custom IX handler inside
// the caller program and enable CPI in Anchor.toml...



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

  // Derive the DTM PDA using caller program and caller
  const [dappTokenManagerPda, dappTokenManagerBump] = anchor.utils.publicKey.findProgramAddressSync(
    [
      Buffer.from("dapp-token-manager"),
      dappTokenMintPubkey.toBuffer(),
      masterProgram.programId.toBuffer(),
    ],
    dappTokenManagerProgram.programId
  );

  // Q: Not sure if this is right. The caller program is going to
  // invoke my DTMP program to create a new DTM for the caller program,
  // which it can then use to manage its own mint. 
  // Example Scenario: My Ledger Program (caller) uses CPI to invoke
  // this DTMP program. But how/where does it invoke this? And how
  // will it pay? I know I need to build a custom IX handler inside
  // the caller program and enable CPI in Anchor.toml...
  const callerPayerWallet = anchor.web3.Keypair.generate();
  console.log("callerPayerWallet: ", callerPayerWallet.publicKey.toBase58())

  // Random user wanting to mint new supply
  const user1Wallet = anchor.web3.Keypair.generate();
  console.log("user1Wallet: ", user1Wallet.publicKey.toBase58())
  let user1TokenAccount;

  before(async () => {
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        callerPayerWallet.publicKey,
        anchor.web3.LAMPORTS_PER_SOL * 2
      )
    );
    console.log(
      `callerPayerWallet balance: ${await provider.connection.getBalance(callerPayerWallet.publicKey)}`
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

  it("Create dappTokenManager and dappTokenMintPersist", async () => {
    // IMPORTANT: Once deployed I no longer need
    // to run this code ever again! 
    const tx = await dappTokenManagerProgram.methods
      .createDappTokenManager()
      .accounts({
        mint: dappTokenMintPersistKeypair.publicKey,
        dappTokenManager: dappTokenManagerV3Pda,
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
    dappTokenManager = await program.account.dappTokenManager.fetch(
      dappTokenManagerV3Pda
    );
    console.log("dappTokenManager: ", dappTokenManager);

    dappTokenMintPersist = await getMint(provider.connection, dappTokenManager.mint);
    console.log("dappTokenMintPersist: ", dappTokenMintPersist);

    expect(dappTokenManager.mint.toBase58()).to.equal(dappTokenMintPersistKeypair.publicKey.toBase58());
    expect(dappTokenManager.totalUserMintCount.toNumber()).to.equal(0);
    expect(dappTokenManager.bump).to.equal(dappTokenManagerV3Bump);
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
          dappTokenManager: dappTokenManagerV3Pda,
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
    dappTokenManager = await program.account.dappTokenManager.fetch(dappTokenManagerV3Pda);
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
    console.log('dappTokenMintPersist.supply.toString(): ', dappTokenMintPersist.supply.toString()); // 100000000000
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
    // - dappTokenManager.totalUserMintCount is 1
    expect(dappTokenManager.totalUserMintCount.toNumber()).to.equal(1);
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
          dappTokenManager: dappTokenManagerV3Pda,
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
    dappTokenManager = await program.account.dappTokenManager.fetch(dappTokenManagerV3Pda);
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
    // - dappTokenManager.totalUserMintCount is 2
    expect(dappTokenManager.totalUserMintCount.toNumber()).to.equal(2);
    // - user4TokenAccountBalance is MINT_AMOUNT
    expect(currentUser4TokenAccountBalance.value.uiAmount).to.equal(MINT_AMOUNT_UI * 2);
    expect((currentUser4TokenAccountInfo.amount / BigInt(ONE_TOKEN_AMOUNT_RAW)).toString()).to.equal((MINT_AMOUNT_UI * 2).toString());
    // - user4TokenAccount.owner should be user4Wallet.pubkey
    expect(currentUser4TokenAccountInfo.owner.toBase58()).to.equal(user4Wallet.publicKey.toBase58())
  });



});
