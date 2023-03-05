use anchor_lang::prelude::*;
use anchor_spl::associated_token;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

use dapp_token_manager_program::{
    self,
    cpi::accounts::{CreateDappTokenManager, MintDappTokenSupply},
    instructions::{create_dapp_token_manager, mint_dapp_token_supply},
    program::DappTokenManagerProgram,
    state::DappTokenManager,
};
use puppet_program::{self, cpi::accounts::SetData, program::PuppetProgram, Puppet};

// ---------
// IMPORTANT: CPI extends the privileges of caller (master) to callee (puppet).
// If the IX the callee program is processing contains an account that was
// marked as a signer or writable when originally passed into the caller
// program, then it will be considered a signer or writable account in
// the invoked program as well.

// So, first you run some CALLER instruction function where you pass
// in the accounts needed. However, inside this caller fn is where you
// actually invoke a CPI to a CALLEE program. What this means is that
// whatever accounts configuration that was originally (first) passed
// to the CALLER function, will continue/extend inside the CALLEE.
// E.g., If my Master Program IX has a mutable (marked writable) dapp_token_manager
// account, then the dapp_token_manager account will also be writable
// inside the Dapp Token Manager Program (callee) as well!
// ---------
// IMPORTANT: UncheckedAccount vs. Type
// Well, u would want to use Types only when account has data already,
// OR if anchor supports custom attributes to be applied before account 
// has any data (ex. init attribute with T of account). Without attributes
// such as init anchor will expect the data of provided type to exist 
// on the account.
//
// So in case u want to pass account which will be initialised in CPI -
// well u would want to use AccountInfo or UncheckedAccount.
// These 2 are the same. But Unchecked Account is used to emphasise 
// that u don’t perform any checks for the account at all. And so are u
// adding any checks in ur context well it depends on the cpi.
// Usually programs ure cpiing into have checks on accounts in instruction.
// So in that case u would want to have something like:
// /// CHECK: Validated in CPI
// pub item_edition: UncheckedAccount<'info>
// ---------

// Q: Do I need to create an IX for BOTH CreateDappTokenManager AND
// MintDappTokenSupply? Or can I just create one for MintDappTokenSupply?
// My original thought was just MintDappTokenSupply, but may need both?
// U: After going back and forth, what do I really need my Master program
// to CPI invoke the create_dapp_token_manager() IX in DTMP? The DTM Program
// is going to be imported into my project (just like anchor_spl).
// It really just needs to pass 'authority', 'mint',
// and 'supply_amount_per_mint' to create the DTM. But after that, the
// Master (caller) program just needs to be able to authority the DTM
// to mint dapp token supply, right?
// Q: Does my Accounts struct have to match the CPI instruction struct?
// Meaning, do I need the exact same accounts? Seems redundant, right?
// Feels like I should be able to simply use dtmp::cpi::accounts::CreateDappTokenManager
// U: Think I just need to build the CpiContext version, instead of
// the usual Context, since we're invoking via CPI.

declare_id!("CXdpazvEeifrgWfQGbwbtokAewZPsGSGJ2tRCe1Bif8g");

// === Authority as PDA ===
#[program]
mod master_program {
    use super::*;
    // === CPI into Puppet Program
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

    // === CPI into Dapp Token Manager Program
    pub fn dapp_token_instruction_handler(
        ctx: Context<DappTokenInstruction>,
        authority: Pubkey,
        supply_amount_per_mint: u64,
    ) -> Result<()> {
        // NOTE Inside Callee Program (DTMP), the DTM Account is a PDA,
        // with prefix, mint, and authority as seeds.
        // Q: Do I need to sign this with seeds? I don't think so, since
        // technically, the CreateDappTokenManager instruction performs
        // the PDA creation and signs the initialize_mint CPI... I just
        // need to pass everything it needs to read or write to.
        dapp_token_manager_program::cpi::create_dapp_token_manager(
            ctx.accounts.create_dapp_token_manager_ctx(),
            authority,
            supply_amount_per_mint,
        )?;

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
    // IMPORTANT: With PDA, changing authority from Signer to UncheckedAccount.
    // When master_program is invoked, 'authority' PDA is not a signer yet:
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
// instead of building it inside the function
impl<'info> PullStrings<'info> {
    pub fn set_data_ctx(&self) -> CpiContext<'_, '_, '_, 'info, SetData<'info>> {
        // Build and return the CpiContext object
        // Q: Could I use new_with_signer() since a PDA signs?
        // U: Not in this case since 'bump' is passed as IX data!
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

#[derive(Accounts)]
#[instruction(authority: Pubkey, supply_amount_per_mint: u64)]
pub struct DappTokenInstruction<'info> {
    // ==== CreateDappTokenManager ====
    // Q: How many accounts do I need to pass in from
    // the DTMP? Seems redundant...
    // Do I gotta pass in all the accounts ever needed to
    // create a new DTM and mint dapp mint supply,
    // even if CPI module gives me access to same struct?
    // A: Yes, I believe so. This Caller Program will be
    // the first to receive the instruction accounts, and it
    // needs to pass every account that the invoked Callee program
    // will need to process the instruction (read from or write to).
    // NOTE The Contexts I can just use from CPI,
    // I just need to convert from Context > CpiContext
    // U: I'm just passing the minimum needed to rebuild
    // the CpiContexts...
    pub dapp_token_manager_program: Program<'info, DappTokenManagerProgram>,

    // We create the Mint, so making it writable
    #[account(mut)]
    pub mint: Account<'info, Mint>,

    // Q: Do I just copy everything to 'init' dapp_token_manager?
    // Q: Is this a time for UncheckedAccount, since at this point
    // dapp_token_manager isn't created yet?
    // Or, do I do a generic #[account(mut)]?
    // Q: Do we use 'Signer' here since dapp_token_manager
    // account is getting created (init) via CPI, and inside
    // the callee program (DTMP), dapp_token_manager signs
    // with its seeds the CPI to initialize_mint()?
    // NOTE dapp_token_manager probably needs to marked as writable
    // and as a signer as part of how privileges extend from
    // Caller to Callee. If this is correct, then I'll have
    // to provide the seeds using .with_signer() I think...
    // REF: InitFarm -- init_bank_ctx()
    #[account(mut)]
    pub dapp_token_manager: Signer<'info>,

    // Q: What about 'authority' and 'supply_amount_per_mint'??
    // Do I just pass them in the handler or something?
    #[account(mut)]
    pub authority_payer: Signer<'info>,

    pub rent: Sysvar<'info, Rent>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,

    // ==== MintDappTokenSupply Unique Accounts ====
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub associated_token_program: Program<'info, associated_token::AssociatedToken>,
}

impl<'info> DappTokenInstruction<'info> {
    fn create_dapp_token_manager_ctx(
        &self,
    ) -> CpiContext<'_, '_, '_, 'info, CreateDappTokenManager<'info>> {
        CpiContext::new(
            self.dapp_token_manager_program.to_account_info(), // cpi_program
            CreateDappTokenManager {
                // cpi_accounts
                mint: self.mint.to_account_info(),
                dapp_token_manager: self.dapp_token_manager.to_account_info(),
                authority_payer: self.authority_payer.to_account_info(),
                rent: self.rent.to_account_info(),
                token_program: self.token_program.to_account_info(),
                system_program: self.system_program.to_account_info(),
            },
        )
    }

    fn mint_dapp_token_supply_ctx(
        &self,
    ) -> CpiContext<'_, '_, '_, 'info, MintDappTokenSupply<'info>> {
        // NOTE This one needs dapp_token_manager PDA to sign mint_to() CPI
        CpiContext::new(
            self.dapp_token_manager_program.to_account_info(), // cpi_program
            MintDappTokenSupply {
                user_token_account: self.user_token_account.to_account_info(),
                mint: self.mint.to_account_info(),
                dapp_token_manager: self.dapp_token_manager.to_account_info(),
                user: self.user.to_account_info(),
                rent: self.rent.to_account_info(),
                associated_token_program: self.associated_token_program.to_account_info(),
                token_program: self.token_program.to_account_info(),
                system_program: self.system_program.to_account_info(),
            },
        )
    }
}
