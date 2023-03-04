use anchor_lang::prelude::*;
use puppet_program::{self, cpi::accounts::SetData, program::PuppetProgram, Puppet};

declare_id!("CXdpazvEeifrgWfQGbwbtokAewZPsGSGJ2tRCe1Bif8g");

// === Authority as PDA ===
#[program]
mod master_program {
    use super::*;
    pub fn pull_strings(ctx: Context<PullStrings>, bump: u8, data: u64) -> Result<()> {
        // ==== Using a PDA instead of Keypair for puppet ====
        let bump = &[bump][..];
        // Hit the set_data method on the puppet program
        // NOTE Pass our CPI Context to set_data() instruction. 
        // The only difference is this expects a CpiContext instead of just Context.
        // U: With PDA, need to sign CpiContext with PDA seeds
        puppet_program::cpi::set_data(
            // NOTE Don't think we have any seeds besides the 'bump', so not passing as much
            ctx.accounts.set_data_ctx().with_signer(&[&[bump][..]]),
            data,
        )
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
    // IMPORTANT: With PDA, changing authority from Signer to UncheckedAccount. When master_program is invoked,
    // 'authority' PDA is not a signer yet: 
    // Because 'authority' is a PDA generated from:
    // ---
    // await PublicKey.findProgramAddress([], masterProgram.programId) 
    // ---
    // This means we mustn't add a check for it. We just care about allowing
    // master_program to sign so we don't add any additional seeds. Just a bump is passed.
    /// CHECK: only used as a signing PDA
    pub authority: UncheckedAccount<'info>, //pub authority: Signer<'info>,
}

// NOTE Recommended to move CPI setup in impl block of instruction
impl<'info> PullStrings<'info> {
    pub fn set_data_ctx(&self) -> CpiContext<'_, '_, '_, 'info, SetData<'info>> {
        // Build and return the CpiContext object
        CpiContext::new(
            self.puppet_program.to_account_info(), // cpi_program
            // Use accounts context struct (SetData instruction builder) from puppet program
            SetData {
                puppet: self.puppet.to_account_info(), // cpi_accounts
                // IMPORTANT: CPI signed with PDA. When signing a CPI with a PDA,
                // when the CPI is invoked, for each account in the cpi_accounts
                // the Solana runtime will check whether:
                // ---
                // hash(seeds, current_program_id) == account address is TRUE
                // ---
                // If true, that account's 'is_signer' flag will turn true.
                // This means a PDA derived from some programX, may only be used to
                // sign CPIs that originate from programX. So, on a high level, PDA
                // signatures can be considered program signatures.
                // REF: https://book.anchor-lang.com/anchor_in_depth/PDAs.html#programs-as-signers
                // NOTE: Since our masterProgram is invoking the CPI to puppetProgram,
                // the 'authority' PDA can sign as a program signature, since its:
                // ---
                // hash([], masterProgram.programId) == 'authority' is TRUE!
                // ---
                authority: self.authority.to_account_info(), // <-- PDA
            },
        )
    }
}

// use anchor_lang::prelude::*;
// use puppet_program::{self, cpi::accounts::SetData, program::PuppetProgram, Puppet};

// declare_id!("vGymT9KU2hQMZvYxMapvDeqhhyD25VVZ6JKdZjx6925");

// === Authority as KEYPAIR ===
// #[program]
// mod master_program {
//     use super::*;
//     pub fn pull_strings(ctx: Context<PullStrings>, data: u64) -> Result<()> {
//         puppet_program::cpi::set_data(ctx.accounts.set_data_ctx(), data)?;

//         // IMPORTANT When our CPI edits the 'puppet' Account, the master's account
//         // NOT change during the instruction, ie., the ctx.puppet account
//         // won't show any modifications. This is because Account<'info, T> type
//         // (ie., pub puppet: Account<'info, Puppet> in our validation struct)
//         // deserializes the incoming bytes into a NEW struct, which is NO LONGER
//         // connected to the underlying data in the account. The CPI DOES change
//         // the data in the underyling account, but since the struct in the caller (master)
//         // has no connection to the underyling account, the struct in the caller
//         // remains unchanged.
//         // NOTE If you need to read the updated account that's been changed by the CPI,
//         // then call its reload() method which will re-deserialize the account.
//         // NOTE This is something I did in ledger.token_account.reload() to get updated
//         // token balance after a CPI to transfer SPL tokens!
//         ctx.accounts.puppet.reload()?;
//         if ctx.accounts.puppet.data != 42 {
//             // NOTE Will fail if you forget to reload underyling account data
//             panic!();
//         }

//         // Q: How to return values from handler functions?
//         // A: Specify the return type eg. Result<u64>
//         // NOTE If you set a return type in puppet (Result<u64>), then you can get
//         // the return data and do more with it. When you define the return type,
//         // Anchor runs Solana's set_return_data/get_return_data() helpers.
//         // let result = puppet_program::cpi::set_data(ctx.accounts.set_data_ctx(), data)?;
//         // NOTE The below statement calls sol_get_return and deserializes the result.
//         // 'return_data' contain the return from 'set_data', which in this example is just 'data'
//         // NOTE The type returned must implement AnchorSerialize and AnchorDeserialize traits
//         // E.g., #[derive(AnchorSerialize, AnchorDeserialize)] pub struct StructReturn {...}
//         // let return_data = result.get();

//         Ok(())
//     }
// }

// // Instruction validation struct
// #[derive(Accounts)]
// pub struct PullStrings<'info> {
//     #[account(mut)]
//     pub puppet: Account<'info, Puppet>,
//     pub puppet_program: Program<'info, PuppetProgram>,
//     // IMPORTANT: CPI extends the privileges of caller (master) to callee (puppet)
//     // If we add 'authority' field to Puppet struct, then we need to add a Signer here too.
//     // REF https://book.anchor-lang.com/anchor_in_depth/CPIs.html#privilege-extension
//     // Even though the puppet program already checks that authority is a signer
//     // using the Signer type here is still required because the anchor ts client
//     // can not infer signers from programs called via CPIs
//     pub authority: Signer<'info>,
// }

// // NOTE Recommended to move CPI setup in impl block of instruction
// impl<'info> PullStrings<'info> {
//     pub fn set_data_ctx(&self) -> CpiContext<'_, '_, '_, 'info, SetData<'info>> {
//         // Build and return the CpiContext object
//         CpiContext::new(
//             self.puppet_program.to_account_info(), // cpi_program
//             SetData {
//                 puppet: self.puppet.to_account_info(), // cpi_accounts
//                 authority: self.authority.to_account_info(),
//             },
//         )
//     }
// }
