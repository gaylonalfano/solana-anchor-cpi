use anchor_lang::{prelude::*, system_program};
use anchor_spl::token::{self, Token};

use crate::state::DappTokenManager;

// Q: What about allowing a Caller Program to create
// MULTIPLE DappTokenManagers? Or, what if DTM
// could support MULTIPLE Mints? Baby steps...

// IMPORTANT: PDAs can only sign inside program context!
// -------- Instruction Function --------
pub fn handler(
    ctx: Context<CreateDappTokenManager>,
    authority: Pubkey, // Keypair or PDA (flexible I think...)
    supply_amount_per_mint: u64,
) -> Result<()> {
    // 1. CLI/Client: Create a Keypair
    // 2. Program: Create a System Account using Keypair.publicKey
    msg!("1. Creating system account to store the actual mint (token)...");
    system_program::create_account(
        CpiContext::new(
            // Program involved
            ctx.accounts.system_program.to_account_info(),
            // IX accounts
            system_program::CreateAccount {
                from: ctx.accounts.authority_payer.to_account_info(), // fee payer wallet
                to: ctx.accounts.mint.to_account_info(),
            },
        ),
        10000000,                          // lamports
        82,                                // size
        &ctx.accounts.token_program.key(), // owner - TOken Program
    )?;

    // 3. Program: Create the DTM PDA
    msg!("2. Create DappTokenManager PDA using calling program.key() & mint.key() as seeds...");
    let dapp_token_manager = DappTokenManager::new(
        authority, // caller program decides (Keypair, PDA)
        ctx.accounts.mint.key(),
        supply_amount_per_mint,
        ctx.accounts.authority_payer.key(),
        // NOTE bumps.get("account_name"), NOT seed!
        *ctx.bumps
            .get("dapp_token_manager")
            .expect("Bump not found."),
    );
    msg!("DappTokenManager: {:?}", &dapp_token_manager);

    // Need to update the inner Context state of DTM
    ctx.accounts
        .dapp_token_manager
        .set_inner(dapp_token_manager.clone());

    // 4. Program: Initialize the Mint - SPL Token Program
    //      - 4.1 - Set mint authority to DTM PDA
    //      - 4.2 - Set freeze authority to DTM PDA
    msg!("3. Initializing mint account and set authority to dapp_token_manager...");
    token::initialize_mint(
        CpiContext::new_with_signer(
            // Program involved
            ctx.accounts.token_program.to_account_info(),
            // IX accounts
            token::InitializeMint {
                mint: ctx.accounts.mint.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            // Signer Seeds
            &[&[
                DappTokenManager::SEED_PREFIX.as_bytes(),
                ctx.accounts.mint.key().as_ref(),
                authority.as_ref(),
            ]],
        ),
        9,
        &ctx.accounts.dapp_token_manager.key(), // mint authority
        Some(&ctx.accounts.dapp_token_manager.key()), // freeze authority
    )?;
    msg!(
        "Dapp Mint initialized! {:?}",
        &ctx.accounts.mint.to_account_info()
    );

    Ok(())
}

// -------- Accounts Validation Struct -------
#[derive(Accounts)]
#[instruction(authority: Pubkey, supply_amount_per_mint: u64)]
pub struct CreateDappTokenManager<'info> {
    // Client: Pass a Keypair
    #[account(mut)]
    pub mint: Signer<'info>,

    // Q: I want to store the caller_program. Do I have it as an Account,
    // or passed as instruction data?
    // U: Not sure...Going with IX data since this program is the 'puppet',
    // and the caller ('master') should have cpi::context.
    // E.g.:
    // #[account]
    // pub caller_program: Program<'info, CallerProgram>, //???
    // U: Trying 'authority' as IX data from caller, and 
    // 'authority_payer' as the fee payer. Read below.

    // NOTE Add #[instruction(caller_program: Pubkey)] up top
    // so it's accessible (since I'm not passing it as an account)
    #[account(
        init,
        payer = authority_payer,
        space = DappTokenManager::ACCOUNT_SPACE,
        seeds = [
            DappTokenManager::SEED_PREFIX.as_ref(),
            mint.key().as_ref(),
            authority.as_ref(),
        ],
        bump
    )]
    pub dapp_token_manager: Account<'info, DappTokenManager>,

    // U/Q: Should I remove 'authority' as Signer and just make caller program
    // the 'authority'? Puppet passes 'authority' as Instruction Data,
    // so the Master can pass either a Keypair or PDA as 'authority' of Puppet...
    // Who would pay? Need to add a generic 'payer' wallet account? Puppet has
    // a 'user' account as the payer, FYI.
    // U: Renaming this from 'authority' to 'authority_payer', since we need a payer
    // A: Still want an 'authority' field on DTM struct, but going to allow
    // the 'authority' to be passed as Instruction Data (either Keypair or PDA)
    // I think this gives caller more flexibility
    #[account(mut)]
    pub authority_payer: Signer<'info>, // The fee payer (calling program wallet)

    pub rent: Sysvar<'info, Rent>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
