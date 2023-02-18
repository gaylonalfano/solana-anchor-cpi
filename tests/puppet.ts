import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { Keypair, PublicKey } from '@solana/web3.js';
import { expect } from "chai";
import { PuppetProgram } from "../target/types/puppet_program";
import { MasterProgram } from "../target/types/master_program";


describe('puppet', () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const puppetProgram = anchor.workspace.PuppetProgram as Program<PuppetProgram>;
  const masterProgram = anchor.workspace.MasterProgram as Program<MasterProgram>;

  // NOTE We need a puppetKeypair for the Puppet initialize()
  const puppetKeypair = Keypair.generate();

  // Scenario B: authority is a PDA
  // Q: What's happening here? 
  // The Puppet data account still needs a puppetKeypair to sign the initialize() method, 
  // but now we're creating a puppetMasterPDA to pass as puppet's 'authority'. 
  // This is different than just creating a PDA with the masterProgram. 
  // Doing this allows the masterProgram's pullStrings() method ix to be signed by
  // the 'authority' PDA, which is derived from masterProgram.programId + bump
  it('CPI: authority as PDA', async () => {
    const [puppetMasterPDA, puppetMasterBump] = await PublicKey
      .findProgramAddress([], masterProgram.programId);

    await puppetProgram.methods
      .initialize(puppetMasterPDA)
      .accounts({
        puppet: puppetKeypair.publicKey,
        user: provider.wallet.publicKey,
      })
      .signers([puppetKeypair])
      .rpc();

    // Q: Can I use the same PDA authority used to initialize
    // the puppet account to also set_data() even though the 
    // SetData Context struct has authority: Signer type
    // A: NO! Would have to pass authorityKeypair.publicKey
    // **See Scenario A below**
    // await puppetProgram.methods
    //   .setData(new anchor.BN(18))
    //   .accounts({
    //     puppet: puppetKeypair.publicKey,
    //     authority: puppetMasterPDA
    //   })
    //   .rpc();

    // expect((await puppetProgram.account.puppet
    //   .fetch(puppetKeypair.publicKey)).data.toNumber()).to.equal(18);


    await masterProgram.methods
      .pullStrings(puppetMasterBump, new anchor.BN(42))
      .accounts({
        puppetProgram: puppetProgram.programId,
        puppet: puppetKeypair.publicKey,
        authority: puppetMasterPDA // <-- Now just PDA. CPI sets 'authority' PDA
        // account 'is_signer = true', so masterProgram can sign with 'authority'
      })
      .rpc();

    expect((await puppetProgram.account.puppet
      .fetch(puppetKeypair.publicKey)).data.toNumber()).to.equal(42);
  });

  // // Scenario A: authority is a Keypair
  // const authorityKeypair = Keypair.generate();

  // xit('CPI: authority as Keypair', async () => {
  //   await puppetProgram.methods
  //     .initialize(authorityKeypair.publicKey)
  //     .accounts({
  //       puppet: puppetKeypair.publicKey,
  //       user: provider.wallet.publicKey,
  //     })
  //     .signers([puppetKeypair])
  //     .rpc();

  //   await masterProgram.methods
  //     .pullStrings(new anchor.BN(42))
  //     .accounts({
  //       puppetProgram: puppetProgram.programId,
  //       puppet: puppetKeypair.publicKey,
  //       authority: authorityKeypair.publicKey
  //     })
  //     .signers([authorityKeypair])
  //     .rpc();

  //   expect((await puppetProgram.account.puppet
  //     .fetch(puppetKeypair.publicKey)).data.toNumber()).to.equal(42);
  // })

});
