import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { Keypair } from '@solana/web3.js';
import { expect } from "chai";
import { PuppetProgram } from "../target/types/puppet_program";
import { MasterProgram } from "../target/types/master_program";


describe('puppet', () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const puppetProgram = anchor.workspace.PuppetProgram as Program<PuppetProgram>;
  const masterProgram = anchor.workspace.MasterProgram as Program<MasterProgram>;

  // Scenario A: Puppet acct is a standard account
  const puppetKeypair = Keypair.generate();
  const authorityKeypair = Keypair.generate();

  // Scenario B: Puppet acct is a PDA instead

  it('CPI using Keypair', async () => {
    await puppetProgram.methods
      .initialize(authorityKeypair.publicKey)
      .accounts({
        puppet: puppetKeypair.publicKey,
        user: provider.wallet.publicKey,
      })
      .signers([puppetKeypair])
      .rpc();

    await masterProgram.methods
      .pullStrings(new anchor.BN(42))
      .accounts({
        puppetProgram: puppetProgram.programId,
        puppet: puppetKeypair.publicKey,
        authority: authorityKeypair.publicKey
      })
      .signers([authorityKeypair])
      .rpc();

    expect((await puppetProgram.account.puppet
      .fetch(puppetKeypair.publicKey)).data.toNumber()).to.equal(42);
  });
});
