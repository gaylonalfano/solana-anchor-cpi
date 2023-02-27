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

// NOTE General sequence I believe:
// 1. Client: Generate Mint Keypair
// 2. Program: SystemProgram CreateAccount (will have mint address from CLIENT Keypair)
// 3. Program: Create DappTokenManagerV1 PDA
// 4. Program: InitializeMint using mint + PDA & set authority = PDA
// 5. Client: User connects and needs mint supply
// 6. Program: Mint supply using CPI+seeds to PDA user_token_account

// Q/U: After successfully writing a test on localhost, this is how I've divided
// the tasks involved:
// 1. Client: Generate Mint Keypair
//    - NOTE: Could consider creating with CLI or in program
// 2. Client: Derive DappTokenManagerV1 PDA with Mint + Program
// 3. Program: SystemProgram CreateAccount for Mint
// 4. Program: Create DappTokenManagerV1 PDA data account
// 5. Program: InitializeMint using mint + PDA & set authority = PDA
// 6. Client: User connects and needs mint supply
// 7. Client: Create (if needed) user's ATA
//    - NOTE: Could do in program instead using create() + init_if_needed
//            or create_idempotent()
// 8. Program: mint_to() + PDA signer

// TODO
// - Consider building another variation where 'mint' and 'user_token_account'
// are both created inside program instead of using JS. See Bare's snippet below.
// and would have to use create() + init_if_needed feature,
// OR create_idempotent() for ATA.

declare_id!("cPshoEnza1TMdWGRkQyiQQqu34iMDTc7i3XT8uVVfjp");

#[program]
pub mod custom_spl_token {
    use super::*;

    pub fn initialize_dapp_spl_with_keypair(ctx: Context<InitializeDappSplWithKeypair>) -> Result<()> {
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
        let dapp_token_manager_v1 = DappTokenManagerV1::new(
            ctx.accounts.mint.key(),
            ctx.accounts.authority.key(),
            // NOTE bumps.get("account_name"), NOT seed!
            *ctx.bumps
                .get("dapp_token_manager_v1")
                .expect("Bump not found."),
        );
        // Update the inner account data
        // Q: clone() or no?
        ctx.accounts
            .dapp_token_manager_v1
            .set_inner(dapp_token_manager_v1.clone());
        msg!("DappTokenManagerV1: {:?}", &dapp_token_manager_v1);

        // Q: Is this the spl-token create-account <TOKEN_ADDRESS> command?
        // A: NO! This is spl-token create-token --decimals 0
        // NOTE --decimals 0 is the protocol for NFTs
        msg!("3. Initializing mint account as a mint and set authority to dapp_token_manager_v1...");
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
                // Syntax 1: Raw sign with dapp_token_manager_v1 seeds
                &[&[
                    DappTokenManagerV1::SEED_PREFIX.as_bytes(),
                    ctx.accounts.mint.key().as_ref(),
                    &[ctx.accounts.dapp_token_manager_v1.bump],
                ]],
                // Syntax 2: Using helper impl fn instead
                // &[&ctx.accounts.dapp_token_manager_v1.dapp_token_manager_v1_seeds()], // &[&[&[u8]; 3]]
            ),
            9, // decimals
            // Setting dapp_token_manager_v1 as mint authority
            &ctx.accounts.dapp_token_manager_v1.key(), // mint authority
            Some(&ctx.accounts.dapp_token_manager_v1.key()), // freeze authority
        )?;
        msg!(
            "Mint initialized! {:?}",
            &ctx.accounts.mint.to_account_info()
        );

        Ok(())
    }

    pub fn mint_dapp_spl(ctx: Context<MintDappSpl>) -> Result<()> {
        // Q: Do I need to check whether ATA already exists?
        // U: Don't think so since I'll be using getOrCreateAssociatedTokenAccount() in client...
        // Q: Is this spl-token create-account <TOKEN_ADDRESS> <OWNER_ADDRESS>?
        // A: Yes, I believe this is more-or-less the equivalent, BUT it's hitting
        // the Associated Token Program, which hits the main Token Program, which itself
        // hits the System Program that creates the ATA.
        // Q: Do I need this if I'm calling getOrCreateAssociatedTokenAccount() in client?
        // This is different from NFT ATA, since the user could possibly already
        // have an ATA for dapp mint.
        // U: Removing at_create() to see...
        // A: Not needed if I'm creating the ATA from the CLIENT!
        // There is a create_idempotent() that was suggested, which seems to achieve
        // the same thing as create() + init_if_needed feature.
        // msg!("1. Creating associated token account for the mint and the wallet...");
        // // msg!("Token Address: {}", &ctx.accounts.token_account.to_account_info().key());
        // associated_token::create(CpiContext::new(
        //     ctx.accounts.associated_token_program.to_account_info(),
        //     associated_token::Create {
        //         payer: ctx.accounts.user.to_account_info(),
        //         associated_token: ctx.accounts.user_token_account.to_account_info(),
        //         // Q: How do you know which is the authority? Authority of what?
        //         // The wallet that this ATA is getting added to? Perhaps...
        //         // A: Yes! It's the owner's wallet <OWNER_ADDRESS> that has authority of this new ATA!
        //         authority: ctx.accounts.user.to_account_info(),
        //         mint: ctx.accounts.mint.to_account_info(),
        //         system_program: ctx.accounts.system_program.to_account_info(),
        //         // NOTE Still need main token_program to create associated token account
        //         token_program: ctx.accounts.token_program.to_account_info(),
        //     },
        // ))?;

        // Q: Is this spl-token mint <TOKEN_ADDRESS> <AMOUNT> <RECIPIENT_ADDRESS>?
        // A: Yes! This mints (increases supply of Token) and transfers new tokens
        // to owner's token account (default recipient token address) balance
        msg!(
            "2. Minting supply to the token account (signing via dapp_token_manager_v1 PDA seeds)..."
        );
        // msg!("Mint: {}", &ctx.accounts.mint.key());
        // msg!("Token Address: {}", &ctx.accounts.token_account.to_account_info().key());
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(), // Program to ping
                token::MintTo {
                    // Instructions with accounts to pass to program
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.dapp_token_manager_v1.to_account_info(),
                },
                // Sign with PDA seeds
                &[&[
                    DappTokenManagerV1::SEED_PREFIX.as_bytes(),
                    ctx.accounts.mint.key().as_ref(),
                    &[ctx.accounts.dapp_token_manager_v1.bump],
                ]],
            ),
            // Additonal args
            DappTokenManagerV1::MINT_AMOUNT_RAW, // amount
        )?;

        // Update total_user_mint_count
        ctx.accounts.dapp_token_manager_v1.total_user_mint_count += 1;

        Ok(())
    }

    // ------------------ CLI + Program (Fail) --------------
    // U: Need to consider init the Mint directly inside program
    // Could modify my InitializeDappSplWithKeypair
    // pub fn mint_dapp_token_with_cli_and_program(
    //     ctx: Context<MintDappTokenWithCliAndProgram>,
    // ) -> Result<()> {
    //     // NOTE Mint created with CLI. Just need to create ATA and mint_to()
    //     // const cli_dapp_token_address = Pubkey::new()
    //     // Q: Where do I derive the PDA? Program or Client?
    //     // REF: https://docs.rs/anchor-lang/latest/anchor_lang/prelude/struct.Pubkey.html#method.find_program_address
    //     // A: CLIENT! IMPORTANT: Below will give me an address,
    //     // BUT, the IX needs an ACCOUNT to sign! 
    //     // ALL accounts, due to design, should be passed 
    //     // to initial instruction! Therefore, I need to pass
    //     // this PDA from the CLIENT!
    //     // NOTE: I don't need to initialize the account or anything.
    //     // I just pass it and that's it. My program IX will do
    //     // the rest of whatever else is needed.
    //     // let (dapp_token_signer_pda, dapp_token_signer_bump) = Pubkey::find_program_address(
    //     //     &[
    //     //         b"dapp-token-mint-authority",
    //     //         ctx.accounts.mint.key().as_ref(),
    //     //     ],
    //     //     &ctx.program_id,
    //     // );
    //     // let dapp_token_signer_seeds = &[
    //     //     "dapp-token-mint-authority".as_bytes(),
    //     //     &[dapp_token_signer_bump],
    //     // ];

    //     msg!("1. Creating associated token account for user (if needed)...");
    //     // Q: create_idempotent need 'init' or 'mut' for user_token_account
    //     // inside validation struct? My guess is 'init'
    //     associated_token::create_idempotent(CpiContext::new(
    //         ctx.accounts.associated_token_program.to_account_info(),
    //         associated_token::Create {
    //             associated_token: ctx.accounts.user_token_account.to_account_info(),
    //             authority: ctx.accounts.user.to_account_info(),
    //             mint: ctx.accounts.mint.to_account_info(),
    //             payer: ctx.accounts.user.to_account_info(),
    //             system_program: ctx.accounts.system_program.to_account_info(),
    //             token_program: ctx.accounts.token_program.to_account_info(),
    //         },
    //     ))?;

    //     msg!("2. Minting supply to the token account (signing via PDA)...");
    //     token::mint_to(
    //         CpiContext::new_with_signer(
    //             ctx.accounts.token_program.to_account_info(),
    //             token::MintTo {
    //                 mint: ctx.accounts.mint.to_account_info(),
    //                 to: ctx.accounts.user_token_account.to_account_info(),
    //                 // Q: Can I pass just PDA pubkey? Only have address, no account!
    //                 // I will need to set mint.mint_authority = PDA before this part...
    //                 // A: NOPE! Must be an ACCOUNT! 
    //                 // Q: Is Fedoras' 'nft_mint' a PDA? 
    //                 // A: No, 'nft_mint' is a Keypair
    //                 authority: dapp_token_signer_pda
    //             },
    //             // Sign with PDA seeds
    //             &[dapp_token_signer_seeds],
    //         ),
    //         // Additional args (amount, etc)
    //         100000000000, // amount
    //     )?;

    //     // Q: What is initializeMint2()?

    //     Ok(())
    // }


    // -------------- Program ONLY Version2 --------------
    pub fn initialize_dapp_token_manager_v2(ctx: Context<InitializeDappTokenManager>) -> Result<()> {
        msg!("1. Create dapp_token_manager_v2 PDA account...");
        let dapp_token_manager_v2 = DappTokenManagerV2::new(
            ctx.accounts.authority.key(),
            // NOTE Not using mint.key() as seed since dunno how
            // to init both and use (Chicken or Egg scenatio)
            // ctx.accounts.mint.key(),
            // NOTE bumps.get("account_name"), NOT seed!
            *ctx.bumps
                .get("dapp_token_manager_v2")
                .expect("Bump not found."),
        );


        // Update the inner account data
        // Q: clone() or no? Seen both ways...
        ctx.accounts
            .dapp_token_manager_v2
            .set_inner(dapp_token_manager_v2.clone());
        msg!("DappTokenManagerV2: {:?}", &dapp_token_manager_v2);

        Ok(())
    }

    pub fn initialize_dapp_token_mint_v2(ctx: Context<InitializeDappTokenMint>) -> Result<()> {
        // Q: What do I put in here if it's getting created
        // thanks to 'init'? Don't think I need to manually
        // call token::initialize_mint()...
        // Do I need to validate anything else? 
        // require_keys_eq!(
        //     ctx.accounts.mint.mint_authority,
        //     ctx.accounts.dapp_token_manager_v2.key()
        // );

       Ok(()) 
    }

    pub fn mint_dapp_token_supply_v2(ctx: Context<MintDappTokenSupply>) -> Result<()> {
        // U: MUST make the 'mint' account writable since supply will be mutated!
        #[account(
            mut,
            constraint = mint.key() == dapp_token_manager_v2.mint
        )]
        pub mint: Account<'info, Mint>,

        #[account(
            mut,
            seeds = [
                DappTokenManagerV2::SEED_PREFIX.as_ref(),
                // mint.key().as_ref(),
            ],
            bump = dapp_token_manager_v2.bump
        )]
        pub dapp_token_manager_v2: Account<'info, DappTokenManagerV1>,

        pub rent: Sysvar<'info, Rent>,
        pub system_program: Program<'info, System>,
        pub token_program: Program<'info, token::Token>,
        pub associated_token_program: Program<'info, associated_token::AssociatedToken>,

        Ok(())
    }

}

#[derive(Accounts)]
pub struct InitializeDappSplWithKeypair<'info> {
    // Client: Need to pass a Keypair
    #[account(mut)]
    pub mint: Signer<'info>,

    // NOTE I've seen another approach to init the Mint here
    // instead of passing a Keypair.
    // REF: https://github.com/ZYJLiu/token-with-metadata/blob/master/programs/token-with-metadata/src/lib.rs
    // Q: Not sure if I can do this inside same ix validation struct,
    // since dapp_token_manager_v1 is also getting initialized in same ix.
    // A: Nope. Maybe with init_if_needed but nice to know there's a variant out there
    // #[account(
    //     init,
    //     payer = authority,
    //     mint::decimals = 9,
    //     mint::authority = dapp_token_manager_v1,
    // )]
    // pub mint: Account<'info, Mint>,

    // Client: Need to findProgramAddressSync() for PDA
    #[account(
        init,
        payer = authority,
        space = DappTokenManagerV1::ACCOUNT_SPACE,
        seeds = [
            DappTokenManagerV1::SEED_PREFIX.as_ref(),
            mint.key().as_ref(),
            // Q: How to get current programId?
            // I can access it in ix using ctx.programId, but dunno how here...
            // U: Not necessary as programId is part of deriving PDA anyway!
        ],
        bump
    )]
    pub dapp_token_manager_v1: Account<'info, DappTokenManagerV1>,

    // U: Don't think I even need an ATA for DappTokenManagerV1 PDA. 
    // A: Yep, can mint_to() without needing an ATA inside DappTokenManagerV1
    // Client: This is connected wallet
    #[account(mut)]
    pub authority: Signer<'info>, // The wallet (fee payer)

    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, token::Token>,
}

#[derive(Accounts)]
pub struct MintDappSpl<'info> {
    // U: Separating out from initializing the dapp SPL
    // Using this instruction to mint supply to a new user.
    // Thinking of using this whenever a user wallet creates
    // a new ledger, this will mint supply to the wallet and be
    // signed by PDA. May consider adding a mint_number to Ledger struct
    // or maybe create another Profile struct to limit the number of
    // times we mint supply to same wallet. Thinking 100k per ledger

    // TODOS:
    // - DONE Bring in dapp_token_manager_v1 account
    // - DONE Bring in user (wallet) account
    // - DONE rent, system_program, token_program, associated_token
    // - Determine the names for the user wallet (user, payer, authority) -- Choose one!
    // - Build the actual instruction method
    // - Checks/constraints to consider:
    //   - Q: How to prevent one user getting all the supply?
    //   - mint.key() == dapp_token_manager_v1.mint
    //   - user_token_account.mint == dapp_token_manager_v1.mint
    //   - user_token_account.owner == user.key()
    //   - mint.mint_authority == dapp_token_manager_v1
    //   - mint.freeze_authority == dapp_token_manager_v1
    //   - mint.supply < mint.cap
    // #[account(mut)]
    // pub user: Signer<'info>, // wallet

    // U: Bare would use `init_if_needed` instead of creating from Client
    // #[account(init_if_needed,
    //     payer = signer,
    //     associated_token::mint = mint,
    //     associated_token::authority = signer)]
    // pub user_token_account: Account<'info, TokenAccount>,

    // U: MUST make the 'mint' account writable since supply will be mutated!
    #[account(
        mut,
        constraint = mint.key() == dapp_token_manager_v1.mint
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [
            DappTokenManagerV1::SEED_PREFIX.as_ref(),
            mint.key().as_ref(),
        ],
        bump = dapp_token_manager_v1.bump
    )]
    pub dapp_token_manager_v1: Account<'info, DappTokenManagerV1>,

    // Q: I need to init this the first time for the user
    // May want to consider the 'init_if_needed' feature
    // A: Instead of using 'init_if_needed' here, I can
    // instead create the ATA from the CLIENT using
    // getOrCreateAssociatedTokenAccount(). This way I can
    // add the constraints on the account.
    // REF: Escrow program tests 'buyer_z_token_account'
    #[account(
        mut,
        constraint = user_token_account.mint == mint.key(),
        // Q: What happens if I remove user input account and
        // this constraint? If I have user & this constraint,
        // I encounter TokenAccountNotFoundError. If I don't pass
        // user input account but keep this constraint, I get 
        // raw contraint violation error.
        // U: I THINK I only need to pass user wallet (payer) and
        // add this constraint when doing TRANSFER...
        // constraint = user_token_account.owner == user.key(),
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, token::Token>,
    // pub associated_token_program: Program<'info, associated_token::AssociatedToken>,
}

// ========== Above works. Trying different variations below ==========
// ----- CLI + Program Approach -----
// U: Going for CLI+Program Approach. Something like:
// NOTE Brainstorming CLI + PDA (but no PDA data account ie DappTokenManagerV1)
// 1. CLI: Create Mint
// 2. Client: Derive a PDA address (not account!) with Mint + Program
//    - IMPORTANT: MUST find PDA from CLIENT!
// 3. CLI: Set mint and freeze authority to PDA
// 4. Program: Create (if needed) user ATA with create_idempotent()
// 5. Program: mint_to() + PDA signer
#[derive(Accounts)]
pub struct MintDappTokenWithCliAndProgram<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    // U: Bare would use `init_if_needed` instead of creating from Client
    // Q: What macro attributes needed if create_idempotent()? init or mut?
    #[account(
        init,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    // U: MUST make the 'mint' account writable since supply will be mutated!
    // Q: Any constraints to add? Don't have a PDA account (just address)
    #[account(mut)]
    pub mint: Account<'info, Mint>,

    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, token::Token>,
    pub associated_token_program: Program<'info, associated_token::AssociatedToken>,
}

// ------------- Program ONLY Approach -------------
// NOTE: Creating Mint and ATA inside Program instead
// Going to break it up into a few instructions:
// 1. Program: Create Mint (using 'init' and Mint -- pass Keypair from Client)
//      - NOTE: Can set authority, decimals, etc. in this step
// 2. Program: Create DappTokenManagerV1 PDA account
// 3. Program: Create (if needed) user ATA
// 4. Program: MintTo + PDA signer
// Q: Should I create DTManager first and then DTMint?
// DTManager doesn't have to use mint key as seed...


#[derive(Accounts)]
pub struct InitializeDappTokenManager<'info> {
    // NOTE: Need to findProgramAddressSync() for PDA
    // and send from CLIENT!
    #[account(
        init,
        payer = authority,
        space = DappTokenManagerV2::ACCOUNT_SPACE,
        seeds = [
            DappTokenManagerV2::SEED_PREFIX.as_ref(),
            // NOTE Removing mint.key() seed since Mint
            // gets created next
        ],
        bump
    )]
    pub dapp_token_manager_v2: Account<'info, DappTokenManagerV2>,

    // U: Don't think I even need an ATA for DappTokenManagerV1 PDA. 
    // A: Yep, can mint_to() without needing an ATA inside DappTokenManagerV1
    // Client: This is connected wallet
    #[account(mut)]
    pub authority: Signer<'info>, // The wallet (fee payer)

    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, token::Token>,

}

#[derive(Accounts)]
pub struct InitializeDappTokenMint<'info> {
    // Q: By initializing mint inside program using 'init',
    // guess I just need a payer to sign? Or, probably still
    // need to add client Keypair as a signer in frontend?
    // U: The token-with-metadata repo does not have the mintKeypair
    // as a signer in the client, FYI.
    // REF: https://github.com/ZYJLiu/token-with-metadata/blob/master/tests/token-with-metadata.ts
    #[account(
        init,
        payer = authority,
        mint::decimals = 9,
        mint::authority = dapp_token_manager_v2,
        mint::freeze_authority = dapp_token_manager_v2,
    )]
    pub mint: Account<'info, Mint>,

    // Q: Do I need to pass DTM if only need its address?
    // U: I think so since it can find the PDA. But, I may
    // be able to pass DTM address as a separate IX argument...
    #[account(
        mut,
        seeds = [
            DappTokenManagerV2::SEED_PREFIX.as_ref(),
            // Q: Can I access mint.key() since mint is 
            // getting initialized in this same IX?
            // mint.key().as_ref(),
            // U: I removed 'mint' as a seed, but curious...
        ],
        bump = dapp_token_manager_v2.bump
    )]
    pub dapp_token_manager_v2: Account<'info, DappTokenManagerV2>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, token::Token>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,

}


#[derive(Accounts)]
pub struct MintDappTokenSupply<'info> {
    // U: Bare would use `init_if_needed` instead of creating from Client
    // NOTE Need to add features = ["init-if-needed"] in Cargo.toml
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = user
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    // IMPORTANT: MUST make the 'mint' account writable since supply will be mutated!
    #[account(
        mut,
        constraint = mint.key() == dapp_token_manager_v2.mint
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [
            DappTokenManagerV2::SEED_PREFIX.as_ref(),
        ],
        bump = dapp_token_manager_v2.bump
    )]
    pub dapp_token_manager_v2: Account<'info, DappTokenManagerV2>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub rent: Sysvar<'info, Rent>,
    pub associated_token_program: Program<'info, associated_token::AssociatedToken>,
    pub token_program: Program<'info, token::Token>,
    pub system_program: Program<'info, System>,
}

// U: Adding another high-level account to enable multiple escrows created by same/single wallet
// NOTE: Technically don't need to create a data account for the PDA. This is only if I want
// to store some data like bump, etc.
#[account]
#[derive(Default, Debug)]
pub struct DappTokenManagerV1 {
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

impl DappTokenManagerV1 {
    pub const ACCOUNT_SPACE: usize = DISCRIMINATOR_LENGTH
        + MINT_LENGTH
        + AUTHORITY_LENGTH
        + TOTAL_USER_MINT_COUNT_LENGTH
        + BUMP_LENGTH;

    pub const SEED_PREFIX: &'static str = "dapp-token-manager-v1";
    // NOTE To get MAX of type: u32::MAX
    // Q: Need &'static lifetime for u64?
    pub const MINT_AMOUNT_RAW: u64 = 1000000000 * 100; // 100 Tokens
    pub const MINT_AMOUNT_UI: u64 = 100; // 100 Tokens

    pub fn new(mint: Pubkey, authority: Pubkey, bump: u8) -> Self {
        DappTokenManagerV1 {
            mint,
            authority,
            // Q: Could I add a mint_number field in Ledger?
            // Or, perhaps create a Profile struct with total_mint_count as well?
            // The idea is to limit a user wallet from minting too much.
            // Maybe I could check that number of Ledgers associated
            // with wallet is == profile.total_mint_count
            total_user_mint_count: 0,
            bump,
        }
    }

    // pub fn dapp_token_manager_v1_seeds(&self) -> [&[u8]; 3] {
    //     // REF: gem_bank::vault
    //     // [self.authority_seed.as_ref(), &self.authority_bump_seed]
    //     // NOTE: The above is signed like this:
    //     // t::transfer(ctx.accounts.transfer_ctx().with_signer(&[&vault.vault_seeds()]),

    //
    //     [
    //         DappTokenManagerV1::SEED_PREFIX.as_bytes(), // &[u8]
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

// Adding another version that doesn't use mint.key()
// as a seed. May even store the Mint account inside
#[account]
#[derive(Default, Debug)]
pub struct DappTokenManagerV2 {
    // 8 bytes for Discrimator
    pub mint: Pubkey,               // 32 bytes
    pub authority: Pubkey,          // 32 bytes Initializer/Payer
    pub total_user_mint_count: u64, // 8 bytes
    pub bump: u8,                   // 1 byte
}

impl DappTokenManagerV2 {
    pub const ACCOUNT_SPACE: usize = DISCRIMINATOR_LENGTH
        + MINT_LENGTH
        + AUTHORITY_LENGTH
        + TOTAL_USER_MINT_COUNT_LENGTH
        + BUMP_LENGTH;

    pub const SEED_PREFIX: &'static str = "dapp-token-manager-v2";
    // NOTE To get MAX of type: u32::MAX
    // Q: Need &'static lifetime for u64?
    pub const MINT_AMOUNT_RAW: u64 = 1000000000 * 100; // 100 Tokens
    pub const MINT_AMOUNT_UI: u64 = 100; // 100 Tokens

    pub fn new(mint: Pubkey, authority: Pubkey, bump: u8) -> Self {
        DappTokenManagerV2 {
            mint,
            authority,
            // Q: Could I add a mint_number field in Ledger?
            // Or, perhaps create a Profile struct with total_mint_count as well?
            // The idea is to limit a user wallet from minting too much.
            // Maybe I could check that number of Ledgers associated
            // with wallet is == profile.total_mint_count
            total_user_mint_count: 0,
            bump,
        }
    }

}

// #[cfg(test)]
// mod tests {
//     use super::*;

//     #[test]
//     fn test_time_tracker() {
//         let times = TimeTracker {
//             duration_sec: 100,
//             reward_end_ts: 200,
//             lock_end_ts: 0,
//         };

//         assert_eq!(70, times.remaining_duration(130).unwrap());
//         assert_eq!(0, times.remaining_duration(9999).unwrap());
//         assert_eq!(30, times.passed_duration(130).unwrap());
//         assert_eq!(199, times.reward_upper_bound(199));
//         assert_eq!(200, times.reward_upper_bound(201));
//         assert_eq!(100, times.reward_begin_ts().unwrap());
//         assert_eq!(110, times.reward_lower_bound(110).unwrap());
//     }

//     #[test]
//     fn test_time_tracker_end_reward() {
//         let mut times = TimeTracker {
//             duration_sec: 80,
//             reward_end_ts: 200,
//             lock_end_ts: 0,
//         };

//         times.end_reward(140).unwrap();
//         assert_eq!(times.duration_sec, 20);
//         assert_eq!(times.reward_end_ts, 140);

//         // repeated calls with later TS won't have an effect
//         times.end_reward(150).unwrap();
//         assert_eq!(times.duration_sec, 20);
//         assert_eq!(times.reward_end_ts, 140);
//     }

//     #[test]
//     fn test_funds_tracker() {
//         let funds = FundsTracker {
//             total_funded: 100,
//             total_refunded: 50,
//             total_accrued_to_stakers: 30,
//         };

//         assert_eq!(20, funds.pending_amount().unwrap());
//     }
// }
