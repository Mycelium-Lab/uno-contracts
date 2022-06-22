const { expectRevert, expectEvent, BN } = require('@openzeppelin/test-helpers')
const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades')
const IStakingRewards = artifacts.require('IStakingRewards')
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')

const AccessManager = artifacts.require('UnoAccessManager') 
const FarmFactory = artifacts.require('UnoFarmFactory') 

const Farm = artifacts.require('UnoFarmQuickswap')
const AssetRouter = artifacts.require('UnoAssetRouterQuickswap')

const pauser = '0x2Aae5d0f3bee441ACc1fb2ABE9C2672A54F4bb48'
const distributor = '0xA7b7DDF752Ed3A9785F747a3694760bB8994e15F'

const pool =  "0xAFB76771C98351Aa7fCA13B130c9972181612b54" //usdt usdc 
const amounts = [new BN(1000), new BN(3000), new BN(500), new BN(4000), new BN(52792912217)]

contract('UnoAssetRouterQuickswap', accounts => {
    accounts[0] = "0xA4d07c23F28A1eb1ae471e530c3f5e0038d282F2"//"0xEa6E311c23
    accounts[1] = "0x4AF7f964fb155cc2d59fcD8cA6f2E956d995cBDE"//"0xA7b7DDF752

    let accessManager
    let assetRouter 
    let factory 

    let stakingRewards
    let stakingToken
    
    before(async () => {
        const implementation = await Farm.new({from: accounts[0]})
        accessManager = await AccessManager.new({from: accounts[0]})

        await accessManager.grantRole('0xfbd454f36a7e1a388bd6fc3ab10d434aa4578f811acbbcf33afb1c697486313c', distributor, {from: accounts[0]}) //DISTRIBUTOR_ROLE
        await accessManager.grantRole('0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a', pauser, {from: accounts[0]}) //PAUSER_ROLE

        assetRouter = await deployProxy(
            AssetRouter,
            { kind: 'uups', initializer: false }
        )

        factory = await FarmFactory.new(implementation.address, accessManager.address, assetRouter.address, {from: accounts[0]})

        stakingRewards = await IStakingRewards.at(pool)
        const stakingTokenAddress = await stakingRewards.stakingToken()
        stakingToken = await IUniswapV2Pair.at(stakingTokenAddress)
    })

    describe('Initializes variables', () => {
        it('Sets accessManager', async () => {
            assert.equal(
                await assetRouter.accessManager(),
                accessManager.address,
                "accessManager not set"
            )
        })

        it('Sets farmFactory', async()=>{
            assert.equal(
                await assetRouter.farmFactory(),
                factory.address,
                "farmFactory not set"
            )
        })
    })

    describe('Deposits', () => {
        it('reverts if total amount provided is zero', async () => {
            await expectRevert(
                assetRouter.deposit(pool, 0, 0, 0, 0, 0, accounts[0], {from: accounts[0]}),
                "NO_LIQUIDITY_PROVIDED"
            )
        })
        let farm
        describe('deposit lp tokens in new pool', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[0], {from: accounts[0]})
                receipt = await assetRouter.deposit(pool, 0, 0, 0, 0, amounts[0], accounts[0], {from: accounts[0]})

                const farmAddress = await factory.Farms(pool)
                farm = await Farm.at(farmAddress)
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {lpPool:pool, from:accounts[0], recipient: accounts[0], amount:amounts[0]})
            })
            it('sets right variables', async () => {
                assert.equal(
                    await farm.rewardToken(),
                    await stakingRewards.rewardsToken(),
                    "Reward token is not correct"
                )
                assert.equal(
                    await farm.lpPair(),
                    stakingToken.address,
                    "Staking token is not correct"
                )
                assert.equal(
                    await farm.tokenA(),
                    await stakingToken.token0(),
                    "TokenA is not correct"
                )
                assert.equal(
                    await farm.tokenB(),
                    await stakingToken.token1(),
                    "TokenB is not correct"
                )
                assert.equal(
                    await farm.assetRouter(),
                    assetRouter.address,
                    "TokenB is not correct"
                )
            })
            it('updates stakes' ,async () => {
                const {stakeLP} = await assetRouter.userStake(accounts[0], pool)
                assert.equal(
                    stakeLP.toString(),
                    amounts[0].toString(),
                    "Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.equal(
                    (await stakingRewards.balanceOf(farm.address)).toString(),
                    amounts[0].toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance"
                )
            })
        })
        describe('deposits from the same account add up', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[1], {from: accounts[0]})
                receipt = await assetRouter.deposit(pool, 0, 0, 0, 0, amounts[1], accounts[0], {from: accounts[0]})
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {lpPool:pool, from: accounts[0], recipient: accounts[0], amount:amounts[1]})
            })
            it('updates stakes' ,async () => {
                const {stakeLP} = await assetRouter.userStake(accounts[0], pool)
                assert.equal(
                    stakeLP.toString(),
                    (amounts[0].add(amounts[1])).toString(),
                    "Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    (amounts[0].add(amounts[1])).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.equal(
                    (await stakingRewards.balanceOf(farm.address)).toString(),
                    (amounts[0].add(amounts[1])).toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance"
                )
            })
        })
        describe('deposit lp tokens from different account', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[2], {from: accounts[1]})
                receipt = await assetRouter.deposit(pool, 0, 0, 0, 0, amounts[2], accounts[1], {from: accounts[1]} )
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {lpPool:pool, from: accounts[1], recipient: accounts[1], amount: amounts[2]})
            })
            it("doesn't change stakes for account[0]" ,async () => {
                const {stakeLP} = await assetRouter.userStake(accounts[0], pool)
                assert.equal(
                    stakeLP.toString(),
                    (amounts[0].add(amounts[1])).toString(),
                    "Amount sent changed userStake for accounts[0]"
                )
            })
            it('updates stakes for account[1]' ,async () => {
                const {stakeLP} = await assetRouter.userStake(accounts[1], pool)
                assert.equal(
                    stakeLP.toString(),
                    amounts[2].toString(),
                    "Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    (amounts[0].add(amounts[1]).add(amounts[2])).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.equal(
                    (await stakingRewards.balanceOf(farm.address)),
                    (amounts[0].add(amounts[1]).add(amounts[2])).toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance"
                )
            })
        })
        describe('deposit lp tokens for different user', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[3], {from: accounts[0]})
                receipt = await assetRouter.deposit(pool, 0, 0, 0, 0, amounts[3], accounts[1], {from: accounts[0]})
            })
            it('fires event', async () => {
                expectEvent(receipt, 'Deposit', {lpPool:pool, from: accounts[0], recipient: accounts[1], amount:amounts[3]})
            })
            it('doesnt change stakes for accounts[0]' ,async () => {
                const { stakeLP } = await assetRouter.userStake(accounts[0], pool)
                assert.equal(
                    stakeLP.toString(),
                    (amounts[0].add(amounts[1])).toString(),
                    "stakeLP is not 0"
                )
            })
            it('updates stakes for accounts[1]' ,async () => {
                const { stakeLP } = await assetRouter.userStake(accounts[1], pool)
                assert.equal(
                    stakeLP.toString(),
                    (amounts[2].add(amounts[3])).toString(),
                    "Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    (amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3])).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in StakingRewards contract', async () => {
                assert.equal(
                    (await stakingRewards.balanceOf(farm.address)).toString(),
                    (amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3])).toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance"
                )
            })
        })
        describe('deposit normal tokens', () => {
            let balanceAbefore
            let balanceBbefore
            
            let amountA
            let amountB

            let tokenAContract
            let tokenBContract

            before(async () => {
                const tokenA = await stakingToken.token0()
                const tokenB = await stakingToken.token1()

                tokenAContract = await IUniswapV2Pair.at(tokenA)
                tokenBContract = await IUniswapV2Pair.at(tokenB)

                const routerContract = await IUniswapV2Router01.at(quickswapRouter)
                await stakingToken.approve(quickswapRouter, amounts[4], {from: accounts[0]})
                const tx = await routerContract.removeLiquidity(tokenA, tokenB, amounts[4], 1, 1, accounts[0], '16415710000', {from: accounts[0]})
                const event = tx.receipt.rawLogs.find(l => { return l.topics[0] == '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496' })

                amountA = Web3Utils.hexToNumberString(event.data.substring(0,66))
                amountB = Web3Utils.hexToNumberString('0x' + event.data.substring(66,130))

                balanceAbefore = await tokenAContract.balanceOf(accounts[0])
                balanceBbefore = await tokenBContract.balanceOf(accounts[0])

                await tokenAContract.approve(assetRouter.address, amountA, {from: accounts[0]})
                await tokenBContract.approve(assetRouter.address, amountB, {from: accounts[0]})

                receipt = await assetRouter.deposit( pool, amountA, amountB, 0, 0, 0, accounts[0], {from: accounts[0]})
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {from: accounts[0], recipient: accounts[0], lpPool:pool})
            })
            it('withdraws tokens from balance', async () => {
                const balanceAafter = await tokenAContract.balanceOf(accounts[0])
                approxeq(balanceAbefore.sub(balanceAafter), new BN(amountA), new BN(10), 'Token A amount is not close enough to the LP amount sent')

                const balanceBafter = await tokenBContract.balanceOf(accounts[0])
                approxeq(balanceBbefore.sub(balanceBafter), new BN(amountB), new BN(10), 'Token B amount is not close enough to the LP amount sent')
            })
            it('updates stakes' ,async () => {
                const {stakeLP, stakeA, stakeB} = await assetRouter.userStake(accounts[0], pool)

                approxeq(stakeLP, new BN(amounts[4]), new BN(10), "LP Amount sent doesn't equal userStake")//add to stake
                approxeq(stakeA, new BN(amountA), new BN(10), "TokenA amount sent doesn't equal userStake")//add prev stake
                approxeq(stakeB, new BN(amountB), new BN(10), "TokenB amount sent doesn't equal userStake")//add prev stake
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP, totalDepositsA, totalDepositsB } = await assetRouter.totalDeposits(pool)
                approxeq(totalDepositsLP, new BN(amounts[4]), new BN(10), "Total amount sent doesn't equal totalDeposits")//add to stake
                approxeq(totalDepositsA, new BN(amountA), new BN(10), "Total amountA sent doesn't equal totalDepositsA")//add prev stake
                approxeq(totalDepositsB, new BN(amountB), new BN(10), "Total amountB sent doesn't equal totalDepositsB")//add prev stake
            })
            it('stakes tokens in StakingRewards contract', async () => {
                approxeq(await stakingRewards.balanceOf(farm.address), amounts[4], new BN(10), "Total amount sent doesn't equal totalDeposits")//add to stake
            })
        })
    })
    //pausable - only for pausers, prevents functions from beeng called
    //prevents 2 initializations
    //check deployed farm for onlyAssetRouter
    //router upgradeability
})