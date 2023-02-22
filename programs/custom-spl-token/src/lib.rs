// https://www.youtube.com/watch?v=c1GJ-13z6pE&list=PLUBKxx7QjtVnU3hkPc8GF1Jh4DE7cf4n1&index=8
use {
    anchor_lang::{prelude::*, system_program},
    anchor_spl::{
        associated_token,
        token::{self, Mint, TokenAccount},
    },
};

// Q: For master to CPI this program (e.g., mint more supply, transfer),
// does it need to be set as the mint_authority of the mint account?
// Which means we'd maybe need to first create a PDA between the masterProgram
// and the mint account, and inside there is an ATA? Thinking of Escrow account
// and its ATA.

// Check out SPL Token with Metadata (new with metaplex)
// You can init the Mint instead of passing Keypair from client
// REF: https://github.com/ZYJLiu/token-with-metadata/blob/master/programs/token-with-metadata/src/lib.rs
//

// TODOS:
// - ******====Consolidate the validation struct into InitializeDappSpl
// - Get the sequence right:
// 1. SystemProgram CreateAccount (will have mint address)
// 2. Create DappTokenManager PDA
// 3. InitializeMint using mint + PDA & set authority = PDA
// 4. Mint supply using CPI+seeds to PDA token_account

declare_id!("cPshoEnza1TMdWGRkQyiQQqu34iMDTc7i3XT8uVVfjp");

#[program]
pub mod custom_spl_token {
    use super::*;

    pub fn initialize_dapp_spl(ctx: Context<InitializeDappSpl>) -> Result<()> {
        // Invoke a Cross-program Invocation:
        // NOTE Hits another program by sending required accounts
        // Q: Is this the spl-token create-account <TOKEN_ADDRESS> command?
        // A: NO! I believe this is the CPI to SystemProgram, which creates
        // a fresh account and makes the Token Program its owner.
        msg!("1. Creating account for the actual mint (token)...");
        // msg!("Mint: {}", &ctx.accounts.mint.key());
        system_program::create_account(
            // NOTE The CpiContext stores the program and Accounts
            CpiContext::new(
                // NOTE Every CpiContext takes a program ID and instruction
                // NOTE Program = What program to hit
                // NOTE Instructions = What instructions to pass to the program
                // NOTE Everything is AccountInfo in CpiContext
                // IMPORTANT I believe this is equivalent to AccountInfo[]:
                //
                // &[
                //     mint.clone(), // Clone so ownership isn't moved into each tx
                //     mint_authority.clone(),
                //     token_program.clone(),
                // ]
                ctx.accounts.token_program.to_account_info(),
                system_program::CreateAccount {
                    // Our wallet is paying to create the mint account
                    from: ctx.accounts.authority.to_account_info(), // wallet
                    to: ctx.accounts.mint.to_account_info(),        // mint
                },
            ),
            // Additional params
            10000000,                          // Lamports
            82,                                // Size
            &ctx.accounts.token_program.key(), // Owner i.e. Token Program owns the Mint account
        )?;

        msg!("2. Create dApp + mint PDA...");
        // Q: Can I do this here or should I have a separate ix method?
        let dapp_token_manager = DappTokenManager::new(
            ctx.accounts.mint.key(),
            ctx.accounts.authority.key(),
            // NOTE bumps.get("account_name"), NOT seed!
            *ctx.bumps
                .get("dapp_token_manager")
                .expect("Bump not found."),
        );
        // Update the inner account data
        // Q: clone() or no?
        ctx.accounts
            .dapp_token_manager
            .set_inner(dapp_token_manager.clone());
        msg!("DappTokenManager: {:?}", &dapp_token_manager);

        // Q: Is this the spl-token create-account <TOKEN_ADDRESS> command?
        // A: NO! This is spl-token create-token --decimals 0
        // NOTE --decimals 0 is the protocol for NFTs
        msg!("3. Initializing mint account as a mint and set authority to dapp_token_manager...");
        // Q: Can I use PDA to sign?
        // msg!("Mint: {}", &ctx.accounts.mint.key());
        // token::initialize_mint(
        //     CpiContext::new(
        //         // Q: Do I use to_account_info() or key()?
        //         // A: MUST use to_account_info() inside CpiContext
        //         // NOTE Don't use '&' references when using to_account_info()
        //         // Only use '&' when referencing Pubkeys
        //         ctx.accounts.token_program.to_account_info(), // Pinging Token Program
        //         // Q: What about mint_authority account? Where does it go?
        //         // A: It's still present, just passed as arg to initialize_mint(),
        //         // instead of inside CpiContext. Not 100% sure why...
        //         token::InitializeMint {
        //             // Instructions
        //             mint: ctx.accounts.mint.to_account_info(),
        //             rent: ctx.accounts.rent.to_account_info(),
        //         },
        //     ),
        //     9,                                        // Decimals - Set to 0 for NFTs
        //     &ctx.accounts.mint_authority.key(),       // authority
        //     Some(&ctx.accounts.mint_authority.key()), // freeze authority
        // )?;

        token::initialize_mint(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::InitializeMint {
                    mint: ctx.accounts.mint.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
                // Syntax 1: Raw sign with dapp_token_manager seeds
                &[&[
                    DappTokenManager::SEED_PREFIX.as_bytes(),
                    ctx.accounts.mint.key().as_ref(),
                    &[ctx.accounts.dapp_token_manager.bump],
                ]],

                // Syntax 2: Using helper impl fn instead
                // &[&ctx.accounts.dapp_token_manager.dapp_token_manager_seeds()], // &[&[&[u8]; 3]]
            ),
            9, // decimals
            // Setting dapp_token_manager as mint authority
            &ctx.accounts.dapp_token_manager.key(), // mint authority
            Some(&ctx.accounts.dapp_token_manager.key()), // freeze authority
        )?;
        msg!("Mint initialized! {:?}", &ctx.accounts.mint.to_account_info());


        Ok(())
    }

    // pub fn mint_dapp_spl(ctx: Context<MintDappSpl>) -> Result<()> {
    //     // Q: Is this spl-token create-account <TOKEN_ADDRESS> <OWNER_ADDRESS>?
    //     // A: Yes, I believe this is more-or-less the equivalent, BUT it's hitting
    //     // the Associated Token Program, which hits the main Token Program, which itself
    //     // hits the System Program that creates the ATA.
    //     // Q: Does the System Program assign the Associated Token Program OR
    //     // the Token Program as the OWNER of the ATA? Is there even an Owner to ATAs? Probably...
    //     // NOTE When running this CLI command, the owner of account is our local keypair account
    //     // NOTE This create-account command literally adds the token account (token holdings) inside owner's wallet!
    //     // Q: Is this the Token Metadata Program creating the Metadata Account for the token?
    //     // A: Don't believe so because this comes later with steps 5 and 6 w/ Metaplex
    //     msg!("1. Creating associated token account for the mint and the wallet...");
    //     // msg!("Token Address: {}", &ctx.accounts.token_account.to_account_info().key());
    //     associated_token::create(CpiContext::new(
    //         ctx.accounts.associated_token_program.to_account_info(),
    //         associated_token::Create {
    //             payer: ctx.accounts.mint_authority.to_account_info(),
    //             associated_token: ctx.accounts.token_account.to_account_info(),
    //             // Q: How do you know which is the authority? Authority of what?
    //             // The wallet that this ATA is getting added to? Perhaps...
    //             // A: Yes! It's the owner's wallet <OWNER_ADDRESS> that has authority of this new ATA!
    //             authority: ctx.accounts.mint_authority.to_account_info(),
    //             mint: ctx.accounts.mint.to_account_info(),
    //             system_program: ctx.accounts.system_program.to_account_info(),
    //             // NOTE Still need main token_program to create associated token account
    //             token_program: ctx.accounts.token_program.to_account_info(),
    //         },
    //     ))?;

    //     // Q: Is this spl-token mint <TOKEN_ADDRESS> <AMOUNT> <RECIPIENT_ADDRESS>?
    //     // A: Yes! This mints (increases supply of Token) and transfers new tokens
    //     // to owner's token account (default recipient token address) balance
    //     msg!("2. Minting token to the token account (i.e. give it 1 for NFT)...");
    //     // msg!("Mint: {}", &ctx.accounts.mint.key());
    //     // msg!("Token Address: {}", &ctx.accounts.token_account.to_account_info().key());
    //     token::mint_to(
    //         CpiContext::new(
    //             ctx.accounts.token_program.to_account_info(), // Program to ping
    //             token::MintTo {
    //                 // Instructions with accounts to pass to program
    //                 mint: ctx.accounts.mint.to_account_info(),
    //                 to: ctx.accounts.token_account.to_account_info(),
    //                 authority: ctx.accounts.mint_authority.to_account_info(),
    //             }, // Q: Why not pass rent account? We do in the raw version
    //                                                           // NOTE I believe the raw INSTRUCTION corresponds (mostly) to the
    //                                                           // Anchor CpiContext. It's not 100%, but seems to be mostly the case
    //         ),
    //         // Additonal args
    //         1, // amount
    //     )?;

    //     Ok(())
    // }
}

#[derive(Accounts)]
pub struct InitializeDappSpl<'info> {
    // Client: Need to pass a Keypair
    #[account(mut)]
    pub mint: Signer<'info>,

    // Client: Need to findProgramAddressSync() for PDA
    #[account(
        init,
        payer = authority,
        space = DappTokenManager::ACCOUNT_SPACE,
        seeds = [
            DappTokenManager::SEED_PREFIX.as_ref(),
            mint.key().as_ref(),
            // Q: How to get current programId?
            // I can access it in ix using ctx.programId, but dunno how here...
            // A: Not necessary as programId is part of deriving PDA anyway!
        ],
        bump
    )]
    pub dapp_token_manager: Account<'info, DappTokenManager>,

    // U: Don't think I even need an ATA for DappTokenManager PDA
    // #[account(
    //     init,
    //     payer = authority,
    //     token::mint = mint, // Setting the .mint property
    //     token::authority = dapp_token_manager, // Setting the .authority property to be dapp_token_manager PDA account address
    // )]
    // pub token_account: Account<'info, TokenAccount>,
    // Client: This is connected wallet
    #[account(mut)]
    pub authority: Signer<'info>, // The wallet (fee payer)

    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, token::Token>,
}

// #[derive(Accounts)]
// pub struct MintDappSpl<'info> {
//     // U: Separating out from initializing the dapp SPL
//     // Using this instruction to mint supply to a new user.
//     // Thinking of using this whenever a user wallet creates
//     // a new ledger, this will mint supply to the wallet and be
//     // signed by PDA. May consider adding a mint_number to Ledger struct
//     // or maybe create another Profile struct to limit the number of
//     // times we mint supply to same wallet. Thinking 100k per ledger

//     // TODOS:
//     // - Bring in dapp_token_manager account
//     // - Bring in user (wallet) account
//     // - rent, system_program, token_program, associated_token

//     #[account(
//         mut,
//         constraint = user_token_account.mint == dapp_token_manager.mint,
//         constraint = user_token_account.owner == user.key()
//     )]
//     pub user_token_account: Account<'info, TokenAccount>,



//         #[account(
//         mut, 
//         constraint = seller_out_token_account.mint == out_mint.key(),
//         constraint = seller_out_token_account.owner == seller.key()
//     )] 
//     seller_out_token_account: Account<'info, TokenAccount>,

// }

// U: Adding another high-level account to enable multiple escrows created by same/single wallet
// NOTE: Technically don't need to create a data account for the PDA. This is only if I want
// to store some data like bump, etc.
#[account]
#[derive(Default, Debug)]
pub struct DappTokenManager {
    // 8 bytes for Discrimator
    pub mint: Pubkey,               // 32 bytes
    pub authority: Pubkey,          // 32 bytes Initializer/Payer
    pub total_user_mint_count: u64, // 8 bytes
    pub bump: u8,                   // 1 byte
}

// Adding useful constants for sizing properties to better target memcmp offsets
// REF: https://lorisleiva.com/create-a-solana-dapp-from-scratch/structuring-our-tweet-account#final-code
const DISCRIMINATOR_LENGTH: usize = 8;
const MINT_LENGTH: usize = 32; // Pubkey
const AUTHORITY_LENGTH: usize = 32; // Pubkey
const TOTAL_USER_MINT_COUNT_LENGTH: usize = 8; // u64
const BUMP_LENGTH: usize = 1;

impl DappTokenManager {
    pub const ACCOUNT_SPACE: usize = DISCRIMINATOR_LENGTH
        + MINT_LENGTH
        + AUTHORITY_LENGTH
        + TOTAL_USER_MINT_COUNT_LENGTH
        + BUMP_LENGTH;

    pub const SEED_PREFIX: &'static str = "dapp-token-manager";

    pub fn new(mint: Pubkey, authority: Pubkey, bump: u8) -> Self {
        DappTokenManager {
            mint,
            authority,
            total_user_mint_count: 0,
            bump,
        }
    }

    // pub fn dapp_token_manager_seeds(&self) -> [&[u8]; 3] {
    //     // REF: gem_bank::vault
    //     // [self.authority_seed.as_ref(), &self.authority_bump_seed]
    //     // NOTE: The above is signed like this:
    //     // t::transfer(ctx.accounts.transfer_ctx().with_signer(&[&vault.vault_seeds()]),

    //     
    //     [
    //         DappTokenManager::SEED_PREFIX.as_bytes(), // &[u8]
    //         // Self::SEED_PREFIX.as_bytes(), // &[u8]
    //         self.mint.as_ref(), // &[u8]
    //         // FIXME 'temporary value created'
    //         &[self.bump],       // &[u8]
    //     ]
    // }

    // Q: Worth implementing a mint_to() helper?
    // pub fn mint_to(&self, to: Pubkey) {
    //     token::transfer(, amount)
    // }
}
