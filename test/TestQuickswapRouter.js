const { expectRevert, expectEvent, BN, constants } = require('@openzeppelin/test-helpers')
const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades')
const timeMachine = require('ganache-time-traveler')

const IStakingRewards = artifacts.require('IStakingRewards')
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')
const IUniswapV2Router01 = artifacts.require('IUniswapV2Router01')

const AccessManager = artifacts.require('UnoAccessManager') 
const FarmFactory = artifacts.require('UnoFarmFactory') 

const Farm = artifacts.require('UnoFarmQuickswap')
const AssetRouter = artifacts.require('UnoAssetRouterQuickswap')

const pauser = '0x2Aae5d0f3bee441ACc1fb2ABE9C2672A54F4bb48'
const distributor = '0xA7b7DDF752Ed3A9785F747a3694760bB8994e15F'

const quickswapRouter = "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff"
const pool =  "0xAFB76771C98351Aa7fCA13B130c9972181612b54" //usdt usdc 
const pool2 = "0x28b833473e047f6116C46d8ed5117708eeb151F9" // wmatic wone 
const amounts = [new BN(1000), new BN(3000), new BN(500), new BN(4000), new BN(52792912217)]

approxeq = function(bn1, bn2, epsilon, message) {
    const amountDelta = bn1.sub(bn2).add(epsilon)
    assert.ok(!amountDelta.isNeg(), message);
}

contract('UnoAssetRouterQuickswap', accounts => {
    accounts[0] = "0xA4d07c23F28A1eb1ae471e530c3f5e0038d282F2"
    accounts[1] = "0x4AF7f964fb155cc2d59fcD8cA6f2E956d995cBDE"

    let accessManager
    let assetRouter 
    let factory 

    let stakingRewards
    let stakingToken
    let snapshotId

    let tokenA
    let tokenB

    before(async () => {
        const snapshot = await timeMachine.takeSnapshot()
        snapshotId = snapshot['result']

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

        const tokenAAddress = await stakingToken.token0()
        const tokenBAddress = await stakingToken.token1()

        tokenA = await IUniswapV2Pair.at(tokenAAddress)
        tokenB = await IUniswapV2Pair.at(tokenBAddress)
    })

    describe("Can't call multiple initializations", () => {
        it('Reverts', async()=>{
            await expectRevert(
                assetRouter.initialize(accessManager.address, factory.address, {from: accounts[0]}),
                "Initializable: contract is already initialized"
            )
        })
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

    let farm
    describe('Deposits', () => {
        it('reverts if total amount provided is zero', async () => {
            await expectRevert(
                assetRouter.deposit(pool, 0, 0, 0, 0, 0, accounts[0], {from: accounts[0]}),
                "NO_LIQUIDITY_PROVIDED"
            )
        })
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
            let stakeABefore
            let stakeBBefore
            
            let amountA
            let amountB

            let receipt

            before(async () => {
                const routerContract = await IUniswapV2Router01.at(quickswapRouter)
                await stakingToken.approve(quickswapRouter, amounts[4], {from: accounts[0]})
                const tx = await routerContract.removeLiquidity(tokenA.address, tokenB.address, amounts[4], 1, 1, accounts[0], '16415710000', {from: accounts[0]})
                const event = tx.receipt.rawLogs.find(l => { return l.topics[0] == '0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496' })

                amountA = web3.utils.hexToNumberString(event.data.substring(0,66))
                amountB = web3.utils.hexToNumberString('0x' + event.data.substring(66,130))

                balanceAbefore = await tokenA.balanceOf(accounts[0])
                balanceBbefore = await tokenB.balanceOf(accounts[0]);
                ({stakeLP, stakeA:stakeABefore, stakeB:stakeBBefore} = await assetRouter.userStake(accounts[0], pool));

                await tokenA.approve(assetRouter.address, amountA, {from: accounts[0]})
                await tokenB.approve(assetRouter.address, amountB, {from: accounts[0]})
            })
            it('reverts if minAmountA > amountA || minAmountB > amountB', async () => {
                await expectRevert(
                    assetRouter.deposit(pool, amountA, new BN(1), amountA, 0, 0, accounts[0], {from: accounts[0]}),
                    "INSUFFICIENT_A_AMOUNT"
                )
                await expectRevert(
                    assetRouter.deposit(pool, new BN(1), amountB, 0, amountB, 0, accounts[0], {from: accounts[0]}),
                    "INSUFFICIENT_B_AMOUNT"
                )
            })
            it('fires events', async () => {
                receipt = await assetRouter.deposit(pool, amountA, amountB, 0, 0, 0, accounts[0], {from: accounts[0]})
                expectEvent(receipt, 'Deposit', {lpPool:pool, from: accounts[0], recipient: accounts[0]})
            })
            it('withdraws tokens from balance', async () => {
                const {stakeA, stakeB} = await assetRouter.userStake(accounts[0], pool)
                const balanceAafter = await tokenA.balanceOf(accounts[0])
                const balanceBafter = await tokenB.balanceOf(accounts[0])

                approxeq(stakeA.sub(stakeABefore), balanceAbefore.sub(balanceAafter), new BN(1), "StakeA is not correct")
                approxeq(stakeB.sub(stakeBBefore), balanceBbefore.sub(balanceBafter), new BN(1), "StakeB is not correct")
            })
            it('updates stakes' ,async () => {
                const {stakeLP} = await assetRouter.userStake(accounts[0], pool)
                approxeq(stakeLP, amounts[0].add(amounts[1]).add(amounts[4]), new BN(10), "LP Amount sent doesn't equal userStake")
            })
            it('updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                approxeq(totalDepositsLP, amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).add(amounts[4]), new BN(10), "Total amount sent doesn't equal totalDeposits")
            })
            it('stakes tokens in StakingRewards contract', async () => {
                approxeq(await stakingRewards.balanceOf(farm.address), amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).add(amounts[4]), new BN(10), "Total amount sent doesn't equal totalDeposits")
            })
        })
    })
    describe('withdraw', () => {
        describe('withdraws for multiple accs', () => {
            let balance1before
            let balance2before

            let stake1before
            let stake2before
            
            let receipt1
            let receipt2
            before(async () => {
                balance1before = await stakingToken.balanceOf(accounts[0]);
                balance2before = await stakingToken.balanceOf(accounts[1]);

                ({stakeLP:stake1before} = await assetRouter.userStake(accounts[0], pool));
                ({stakeLP:stake2before} = await assetRouter.userStake(accounts[1], pool));
            
                receipt1 = await assetRouter.withdraw(pool, amounts[0], 0, 0, true, accounts[0], {from: accounts[0]})
                receipt2 = await assetRouter.withdraw(pool, amounts[2], 0, 0, true, accounts[1], {from: accounts[1]})
            })
            it('reverts if the pool doesnt exist', async () => {
                await expectRevert(
                    assetRouter.withdraw(pool2, amounts[0], 0, 0, true, accounts[0], {from: accounts[0]}),
                    "FARM_NOT_EXISTS"
                )
            })
            it('reverts if the stake is zero', async () => {
                await expectRevert.unspecified(
                    assetRouter.withdraw(pool, new BN(1), 0, 0, true, accounts[3], {from: accounts[3]})
                )
            })
            it('reverts if the withdraw amount requested is more than user stake', async () => {
                await expectRevert.unspecified(
                    assetRouter.withdraw(pool, constants.MAX_UINT256, 0, 0, true, accounts[0], {from: accounts[0]})
                )
            })
            it('reverts if amount provided is 0', async () => {
                await expectRevert(
                    assetRouter.withdraw(pool, 0, 0, 0, true, accounts[0], {from: accounts[0]}),
                    "INSUFFICIENT_AMOUNT"
                )
            })
            it('fires events', async () => {
                expectEvent(receipt1, 'Withdraw', {lpPool:pool, from: accounts[0], recipient: accounts[0], amount:amounts[0]})
                expectEvent(receipt2, 'Withdraw', {lpPool:pool, from: accounts[1], recipient: accounts[1], amount:amounts[2]})
            })
        
            it('correctly updates userStake for accounts[0]', async () => {
                const {stakeLP} = await assetRouter.userStake(accounts[0], pool)
                assert.equal(
                    stakeLP.toString(),
                    stake1before.sub(amounts[0]).toString(),
                    "Stake is not zero for accounts[0]"
                )
            })
            it('correctly updates userStake for accounts[1]', async () => {
                const {stakeLP} = await assetRouter.userStake(accounts[1], pool)
                assert.equal(
                    stakeLP.toString(),
                    stake2before.sub(amounts[2]).toString(),
                    "Stake is not right for accounts[1]"
                )
            })
            it('correctly updates totalDeposits', async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    stake1before.sub(amounts[0]).add(stake2before.sub(amounts[2])).toString(),
                    "totalDeposits are not right"
                )
            })
            it('transfers tokens to user', async ()=>{
                const balance1after = await stakingToken.balanceOf(accounts[0])
                assert.equal(
                    (balance1after.sub(balance1before)).toString(),
                    amounts[0].toString(),
                    "Tokens withdrawn for accounts[0] do not equal provided in the withdraw function"
                )
                const balance2after = await stakingToken.balanceOf(accounts[1])
                assert.equal(
                    (balance2after.sub(balance2before)),
                    amounts[2].toString(),
                    "Tokens withdrawn for accounts[1] do not equal provided in the withdraw function"
                )
            })
        })
        describe('withdraws for different acc', () => {
            let balance1before
            let balance2before

            let stake1before
            let stake2before

            let receipt
            before(async () => {
                balance1before = await stakingToken.balanceOf(accounts[0]);
                balance2before = await stakingToken.balanceOf(accounts[1]);

                ({stakeLP:stake1before} = await assetRouter.userStake(accounts[0], pool));
                ({stakeLP:stake2before} = await assetRouter.userStake(accounts[1], pool));
            
                receipt = await assetRouter.withdraw(pool, amounts[1], 0, 0, true, accounts[1], {from: accounts[0]})
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Withdraw', {lpPool:pool, from: accounts[0], recipient: accounts[1], amount:amounts[1]})
            })
            it('correctly changes userStake for accounts[0]', async () => {
                const {stakeLP} = await assetRouter.userStake(accounts[0], pool)
                assert.equal(
                    stakeLP.toString(),
                    (stake1before.sub(amounts[1])).toString(),
                    "Stake is not right for accounts[0]"
                )
            })
            it('doesnt change stake for accounts[1]', async () => {
                const {stakeLP} = await assetRouter.userStake(accounts[1], pool)
                assert.equal(
                    stakeLP.toString(),
                    stake2before.toString(),
                    "Stake is not right for accounts[1]"
                )
            })
            it('transfers tokens to accounts[1]', async ()=>{
                const balance1after = await stakingToken.balanceOf(accounts[0])
                assert.equal(
                    (balance1after.sub(balance1before)).toString(),
                    '0',
                    "Tokens were withdrawn for accounts[0]"
                )
                const balance2after = await stakingToken.balanceOf(accounts[1])
                assert.equal(
                    (balance2after.sub(balance2before)).toString(),
                    amounts[1].toString(),
                    "Tokens withdrawn for accounts[1] do not equal provided in the withdraw function"
                )
            })
        })
        describe('withdraws normal tokens', () => {
            let balanceAbefore
            let balanceBbefore
            let receipt

            let stakeLP1
            let stakeA1
            let stakeB1

            let stakeLP2
            let stakeA2
            let stakeB2

            before(async () => {
                balanceAbefore = await tokenA.balanceOf(accounts[0])
                balanceBbefore = await tokenB.balanceOf(accounts[0]);

                ({stakeLP:stakeLP1, stakeA:stakeA1, stakeB:stakeB1} = await assetRouter.userStake(accounts[0], pool));
                ({stakeLP:stakeLP2, stakeA:stakeA2, stakeB:stakeB2} = await assetRouter.userStake(accounts[1], pool));
                receipt = await assetRouter.withdraw(pool, stakeLP1, 0, 0, false, accounts[0], {from: accounts[0]})
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Withdraw', {lpPool:pool, from: accounts[0], recipient: accounts[0], amount:stakeLP1})
            })
            it('correctly updates accounts[0] stake', async () => {
                const {stakeLP, stakeA, stakeB} = await assetRouter.userStake(accounts[0], pool)
                assert.equal(
                    stakeLP.toString(),
                    '0',
                    "stakeLP is wrong"
                )
                assert.equal(
                    stakeA.toString(),
                    '0',
                    "stakeA is wrong"
                )
                assert.equal(
                    stakeB.toString(),
                    '0',
                    "stakeB is wrong"
                )
            })
            it('doesnt update accounts[1] stake', async () => {
                const {stakeLP, stakeA, stakeB} = await assetRouter.userStake(accounts[1], pool)
                assert.equal(
                    stakeLP.toString(),
                    stakeLP2,
                    "stakeLP is wrong"
                )
                assert.equal(
                    stakeA.toString(),
                    stakeA2,
                    "stakeA is wrong"
                )
                assert.equal(
                    stakeB.toString(),
                    stakeB2,
                    "stakeB is wrong"
                )
            })
            it('transfers tokens to user', async ()=>{
                const balanceAafter = await tokenA.balanceOf(accounts[0])
                assert.equal(
                    (balanceAafter.sub(balanceAbefore)).toString(),
                    stakeA1.toString(),
                    "TokensA withdrawn do not equal deposited"
                )

                const balanceBafter = await tokenB.balanceOf(accounts[0])
                assert.equal(
                    (balanceBafter.sub(balanceBbefore)).toString(),
                    stakeB1.toString(),
                    "TokensB withdrawn do not equal deposited"
                )
            })
        })
        describe('withdraws normal tokens for a different user', () => {
            let balanceAbefore
            let balanceBbefore
            let receipt

            let stakeLP2
            let stakeA2
            let stakeB2
            let stakeLP1
            let stakeA1
            let stakeB1
            before(async () => {
                balanceAbefore = await tokenA.balanceOf(accounts[0])
                balanceBbefore = await tokenB.balanceOf(accounts[0]);

                ({stakeLP:stakeLP1, stakeA:stakeA1, stakeB:stakeB1 } = await assetRouter.userStake(accounts[0], pool));
                ({stakeLP:stakeLP2, stakeA:stakeA2, stakeB:stakeB2 } = await assetRouter.userStake(accounts[1], pool));
                receipt = await assetRouter.withdraw(pool, stakeLP2, 0, 0, false, accounts[0], {from: accounts[1]})
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Withdraw', {lpPool:pool, from: accounts[1], recipient: accounts[0], amount:stakeLP2})
            })
            it('correctly updates accounts[1] stake', async () => {
                const {stakeLP, stakeA, stakeB} = await assetRouter.userStake(accounts[1], pool)
                assert.equal(
                    stakeLP.toString(),
                    '0',
                    "stakeLP is wrong"
                )
                assert.equal(
                    stakeA.toString(),
                    '0',
                    "stakeA is wrong"
                )
                assert.equal(
                    stakeB.toString(),
                    '0',
                    "stakeB is wrong"
                )
            })
            it('doesnt update accounts[0] stake', async () => {
                const {stakeLP, stakeA, stakeB} = await assetRouter.userStake(accounts[0], pool)
                assert.equal(
                    stakeLP.toString(),
                    stakeLP1,
                    "stakeLP is wrong"
                )
                assert.equal(
                    stakeA.toString(),
                    stakeA1,
                    "stakeA is wrong"
                )
                assert.equal(
                    stakeB.toString(),
                    stakeB1,
                    "stakeB is wrong"
                )
            })
            it('transfers tokens to correct user', async ()=>{
                const balanceAafter = await tokenA.balanceOf(accounts[0])
                assert.equal(
                    (balanceAafter.sub(balanceAbefore)).toString(),
                    stakeA2.toString(),
                    "TokensA withdrawn do not equal deposited"
                )

                const balanceBafter = await tokenB.balanceOf(accounts[0])
                assert.equal(
                    (balanceBafter.sub(balanceBbefore)).toString(),
                    stakeB2.toString(),
                    "TokensB withdrawn do not equal deposited"
                )
            })
        })
    })
    /*describe('onlyDistributor, onlyPauser, onlyAdmin', () => {

    })*/
    after(async () => {
        await timeMachine.revertToSnapshot(snapshotId)
    })
    //check getTokens
    //pausable - only for pausers, prevents functions from beeng called
    //router upgradeability
})