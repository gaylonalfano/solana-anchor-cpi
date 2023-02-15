use anchor_lang::prelude::*;
use puppet_program::{self, cpi::accounts::SetData, program::PuppetProgram, Puppet};

declare_id!("vGymT9KU2hQMZvYxMapvDeqhhyD25VVZ6JKdZjx6925");

#[program]
mod master_program {
    use super::*;
    pub fn pull_strings(ctx: Context<PullStrings>, data: u64) -> Result<()> {
        // NOTE Pass our CPI Context to set_data() instruction. Only difference is context.
        puppet_program::cpi::set_data(ctx.accounts.set_data_ctx(), data)?;
        // IMPORTANT When our CPI edits the 'puppet' Account, the master's account
        // NOT change during the instruction, ie., the ctx.puppet account
        // won't show any modifications. This is because Account<'info, T> type
        // (ie., pub puppet: Account<'info, Puppet> in our validation struct)
        // deserializes the incoming bytes into a NEW struct, which is NO LONGER
        // connected to the underlying data in the account. The CPI DOES change
        // the data in the underyling account, but since the struct in the caller (master)
        // has no connection to the underyling account, the struct in the caller
        // remains unchanged.
        // NOTE If you need to read the updated account that's been changed by the CPI,
        // then call its reload() method which will re-deserialize the account.
        // NOTE This is something I did in ledger.token_account.reload() to get updated
        // token balance after a CPI to transfer SPL tokens!
        ctx.accounts.puppet.reload()?;
        if ctx.accounts.puppet.data != 42 {
            // NOTE Will fail if you forget to reload underyling account data
            panic!();
        }

        // Q: How to return values from handler functions?
        // A: Specify the return type eg. Result<u64>
        // NOTE If you set a return type in puppet (Result<u64>), then you can get
        // the return data and do more with it. When you define the return type,
        // Anchor runs Solana's set_return_data/get_return_data() helpers.
        // let result = puppet_program::cpi::set_data(ctx.accounts.set_data_ctx(), data)?;
        // NOTE The below statement calls sol_get_return and deserializes the result.
        // 'return_data' contain the return from 'set_data', which in this example is just 'data'
        // NOTE The type returned must implement AnchorSerialize and AnchorDeserialize traits
        // E.g., #[derive(AnchorSerialize, AnchorDeserialize)] pub struct StructReturn {...}
        // let return_data = result.get();


        Ok(())
    }
}

// Instruction validation struct
#[derive(Accounts)]
pub struct PullStrings<'info> {
    #[account(mut)]
    pub puppet: Account<'info, Puppet>,
    pub puppet_program: Program<'info, PuppetProgram>,
    // IMPORTANT: CPI extends the privileges of caller (master) to callee (puppet)
    // If we add 'authority' field to Puppet struct, then we need to add a Signer here too.
    // REF https://book.anchor-lang.com/anchor_in_depth/CPIs.html#privilege-extension
    // Even though the puppet program already checks that authority is a signer
    // using the Signer type here is still required because the anchor ts client
    // can not infer signers from programs called via CPIs
    pub authority: Signer<'info>
}

// NOTE Recommended to move CPI setup in impl block of instruction
impl<'info> PullStrings<'info> {
    pub fn set_data_ctx(&self) -> CpiContext<'_, '_, '_, 'info, SetData<'info>> {
        // Build and return the CpiContext object
        CpiContext::new(
            self.puppet_program.to_account_info(), // cpi_program
            SetData {
                puppet: self.puppet.to_account_info(), // cpi_accounts
                authority: self.authority.to_account_info()
            }
        )
    }
}
