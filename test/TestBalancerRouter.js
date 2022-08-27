const { expectRevert, expectEvent, BN, constants, time } = require('@openzeppelin/test-helpers')
const { deployProxy, upgradeProxy } = require('@openzeppelin/truffle-upgrades')

const timeMachine = require('ganache-time-traveler')

const IGaugeFactory = artifacts.require('IChildChainLiquidityGaugeFactory')
const IBasePool = artifacts.require('IBasePool')
const IVault = artifacts.require('IVault')

//const IStakingDualRewardsFactory = artifacts.require('IStakingDualRewardsFactory')
const IUniswapV2Pair = artifacts.require('IUniswapV2Pair')

const AccessManager = artifacts.require('UnoAccessManager') 
const FarmFactory = artifacts.require('UnoFarmFactory') 

const Farm = artifacts.require('UnoFarmBalancer')
const AssetRouter = artifacts.require('UnoAssetRouterBalancer')
const AssetRouterV2 = artifacts.require('UnoAssetRouterBalancerV2')

const balancerVault = "0xBA12222222228d8Ba445958a75a0704d566BF2C8"
const gaugeFactoryAddress = "0x3b8cA519122CdD8efb272b0D3085453404B25bD0"

const pool = "0xaF5E0B5425dE1F5a630A8cB5AA9D97B8141C908D" //WMATIC-stMATIC
const pool2 = "0x06Df3b2bbB68adc8B0e302443692037ED9f91b42" //USDC-DAI-miMATIC-USDT

const account1 = "0x70D04384b5c3a466EC4D8CFB8213Efc31C6a9D15"//has to be unlocked and hold 0xaF5E0B5425dE1F5a630A8cB5AA9D97B8141C908D
const account2 = "0x78D799BE3Fd3D96f0e024b9B35ADb4479a9556f5"//has to be unlocked and hold 0xaF5E0B5425dE1F5a630A8cB5AA9D97B8141C908D

const amounts = [new BN(1000000), new BN(3000000), new BN(500000), new BN(4000000), new BN('1000000000000000')]


contract('UnoAssetRouterBalancer', accounts => {
    const admin = accounts[0]
    const pauser = accounts[1]
    const distributor = accounts[2]

    let accessManager, assetRouter, factory

    let stakingToken
    let snapshotId

    let initReceipt = {}


    let poolId, gauge

    let Vault
    let tokens, zeroAmounts

    const tokenContracts = []

    before(async () => {
        const snapshot = await timeMachine.takeSnapshot()
        snapshotId = snapshot['result']

        const implementation = await Farm.new({from: account1})
        accessManager = await AccessManager.new({from: admin})//accounts[0] is admin

        await accessManager.grantRole('0xfbd454f36a7e1a388bd6fc3ab10d434aa4578f811acbbcf33afb1c697486313c', distributor, {from: admin}) //DISTRIBUTOR_ROLE
        await accessManager.grantRole('0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a', pauser, {from: admin}) //PAUSER_ROLE

        assetRouter = await deployProxy(
            AssetRouter,
            { kind: 'uups', initializer: false }
        )

        factory = await FarmFactory.new(implementation.address, accessManager.address, assetRouter.address, {from: account1})

        const _receipt = await web3.eth.getTransactionReceipt(factory.transactionHash)
        const events = await assetRouter.getPastEvents("AllEvents", {
            fromBlock: _receipt.block,
            toBlock: _receipt.block
        })

        //convert web3's receipt to truffle's format
        initReceipt.tx = _receipt.transactionHash
        initReceipt.receipt = _receipt
        initReceipt.logs = events

        const gaugeFactory = await IGaugeFactory.at(gaugeFactoryAddress)
        const gaugeAddress = await gaugeFactory.getPoolGauge(pool)
        gauge = await IUniswapV2Pair.at(gaugeAddress) //this is not a IUniswapV2Pair, however the abi is sufficient for our purposes

        const poolContract = await IBasePool.at(pool)
        poolId = await poolContract.getPoolId()

        stakingToken = await IUniswapV2Pair.at(pool) //this is not a IUniswapV2Pair, however the abi is sufficient for our purposes
        Vault = await IVault.at(balancerVault)

        tokens = (await Vault.getPoolTokens(poolId)).tokens
        zeroAmounts = new Array(tokens.length).fill(0);

        for (let i = 0; i < tokens.length; i++) {
            tokenContracts.push(await IUniswapV2Pair.at(tokens[i])) //should be ERC20 but IUniswapV2Pair has everything we need
        }
    })

    describe("Emits initialize event", () => {
        it('fires events', async () => {
            expectEvent(initReceipt, 'Initialized', { version: new BN(1) })
        })
    })

    describe("Can't call multiple initializations", () => {
        it('Reverts', async()=>{
            await expectRevert(
                assetRouter.initialize(accessManager.address, factory.address, {from: account1}),
                "Initializable: contract is already initialized"
            )
        })
    })

    describe('Initializes variables', () => {
        it('Inits pausable ', async () => {
            assert.equal(
                await assetRouter.paused(),
                false,
                "Pausable not initialized"
            )
        })
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

    describe('getTokens', () => {
        let _tokens
        before(async () => {
            _tokens = await assetRouter.getTokens(pool);
        })
        it('getTokens is correct', async () => {
            for (let i = 0; i < _tokens.length; i++) {
                assert.equal(
                    _tokens[i],
                    tokens[i],
                    "getTokens returned incorrect tokens"
                )
            }
        })
    })

    describe('Pausable', () => {
        describe('reverts', () => {
            it('reverts if called not by a pauser', async () => {
                await expectRevert(
                    assetRouter.pause({from: account1}),
                    "CALLER_NOT_PAUSER"
                )
                await expectRevert(
                    assetRouter.unpause({from: account1}),
                    "CALLER_NOT_PAUSER"
                )
            })
        })

        describe('pauses', () => {
            let receipt
            before(async () => {
                receipt = await assetRouter.pause({from: pauser})
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Paused', {account: pauser})
            })
            it('switches paused state', async () => {
                assert.equal(
                    await assetRouter.paused(),
                    true,
                    "Not paused"
                )
            })
            it('prevents function calls', async () => {
                await expectRevert(
                    assetRouter.deposit(pool, [], [], 0, 0, account1, {from: account1}),
                    "Pausable: paused"
                )
                await expectRevert(
                    assetRouter.withdraw(pool, 0, [], false, account1, {from: account1}),
                    "Pausable: paused"
                )
                await expectRevert(
                    assetRouter.distribute(pool, [], [], [], {from: account1}),
                    "Pausable: paused"
                )
            })
            it('reverts if called pause on paused contract', async () => {
                await expectRevert(
                    assetRouter.pause({from: pauser}),
                    "Pausable: paused"
                )
            })
        })

        describe('unpauses', () => {
            let receipt
            before(async () => {
                receipt = await assetRouter.unpause({from: pauser})
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Unpaused', {account: pauser})
            })
            it('switches paused state', async () => {
                assert.equal(
                    await assetRouter.paused(),
                    false,
                    "Paused"
                )
            })
            it('allows function calls', async () => {
                //Pausable: paused check passes. revert for a different reason
                await expectRevert(
                    assetRouter.deposit(pool, [], [], 0, 0, account1, {from: account1}),
                    "BAD_AMOUNTS_LENGTH"
                )
                await expectRevert(
                    assetRouter.withdraw(pool, 0, [], false, account1, {from: account1}),
                    "FARM_NOT_EXISTS"
                )
                await expectRevert(
                    assetRouter.distribute(pool, [], [], [], {from: account1}),
                    "CALLER_NOT_DISTRIBUTOR"
                )
            })
            it('reverts if called unpause on unpaused contract', async () => {
                await expectRevert(
                    assetRouter.unpause({from: pauser}),
                    "Pausable: not paused"
                )
            })
        })
    })

    describe('Deposits', () => {
        let farm
        describe('reverts', () => {
            it('reverts if total amount provided is zero', async () => {
                await expectRevert(
                    assetRouter.deposit(pool, zeroAmounts, tokens, 0, 0, account1, {from: account1}),
                    "NO_LIQUIDITY_PROVIDED"
                )
            })
        })
        describe('deposit lp tokens in new pool', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[0], {from: account1})
                receipt = await assetRouter.deposit(pool, zeroAmounts, tokens, 0, amounts[0], account1, {from: account1})

                const farmAddress = await factory.Farms(pool)
                farm = await Farm.at(farmAddress)
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {lpPool:pool, sender:account1, recipient: account1, amount:amounts[0]})
            })
            it('updates stakes' ,async () => {
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    amounts[0].toString(),
                    "Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in Gauge contract', async () => {
                assert.equal(
                    (await gauge.balanceOf(farm.address)).toString(),
                    amounts[0].toString(),
                    "Total amount sent doesn't equal gauge balance"
                )
            })
        })
        describe('deposits from the same account add up', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[1], {from: account1})
                receipt = await assetRouter.deposit(pool, zeroAmounts, tokens, 0, amounts[1], account1, {from: account1})
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {lpPool:pool, sender: account1, recipient: account1, amount:amounts[1]})
            })
            it('updates stakes' ,async () => {
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    (amounts[0].add(amounts[1])).toString(),
                    "Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    (amounts[0].add(amounts[1])).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in Gauge contract', async () => {
                assert.equal(
                    (await gauge.balanceOf(farm.address)).toString(),
                    (amounts[0].add(amounts[1])).toString(),
                    "Total amount sent doesn't equal gauge balance"
                )
            })
        })
        describe('deposit lp tokens from different account', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[2], {from: account2})
                receipt = await assetRouter.deposit(pool, zeroAmounts, tokens, 0, amounts[2], account2, {from: account2})
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Deposit', {lpPool:pool, sender: account2, recipient: account2, amount: amounts[2]})
            })
            it("doesn't change stakes for account[0]" ,async () => {
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    (amounts[0].add(amounts[1])).toString(),
                    "Amount sent changed userStake for account1"
                )
            })
            it('updates stakes for account[1]' ,async () => {
                const stakeLP = await assetRouter.userStake(account2, pool)
                assert.equal(
                    stakeLP.toString(),
                    amounts[2].toString(),
                    "Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    (amounts[0].add(amounts[1]).add(amounts[2])).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in Gauge contract', async () => {
                assert.equal(
                    (await gauge.balanceOf(farm.address)),
                    (amounts[0].add(amounts[1]).add(amounts[2])).toString(),
                    "Total amount sent doesn't equal gauge balance"
                )
            })
        })
        describe('deposit lp tokens for different user', () => {
            let receipt
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[3], {from: account1})
                receipt = await assetRouter.deposit(pool, zeroAmounts, tokens, 0, amounts[3], account2, {from: account1})
            })
            it('fires event', async () => {
                expectEvent(receipt, 'Deposit', {lpPool:pool, sender: account1, recipient: account2, amount:amounts[3]})
            })
            it('doesnt change stakes for account1' ,async () => {
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    (amounts[0].add(amounts[1])).toString(),
                    "stakeLP is not 0"
                )
            })
            it('updates stakes for account2' ,async () => {
                const stakeLP = await assetRouter.userStake(account2, pool)
                assert.equal(
                    stakeLP.toString(),
                    (amounts[2].add(amounts[3])).toString(),
                    "Amount sent doesn't equal userStake"
                )
            })
            it('updates totalDeposits', async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    (amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3])).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in Gauge contract', async () => {
                assert.equal(
                    (await gauge.balanceOf(farm.address)).toString(),
                    (amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3])).toString(),
                    "Total amount sent doesn't equal gauge balance"
                )
            })
        })
        describe('deposit normal tokens', () => {
            const balancesBefore = []
            const _amounts = []

            before(async () => {
                const _balancesBefore = []
                for (let i = 0; i < tokenContracts.length; i++){
                    _balancesBefore.push(await tokenContracts[i].balanceOf(account1))
                }

                await stakingToken.approve(Vault.address, amounts[4], {from: account1})
                await Vault.exitPool(
                    poolId, 
                    account1, 
                    account1, 
                    {
                        "assets": tokens,
                        "minAmountsOut": zeroAmounts,
                        "userData": web3.eth.abi.encodeParameters(['uint256','uint256'], ['1', amounts[4].toString()]),
                        "toInternalBalance":false
                    }, 
                    {from: account1}
                );

                for (let i = 0; i < tokenContracts.length; i++){
                    const balance = await tokenContracts[i].balanceOf(account1)
                    balancesBefore.push(balance)

                    const amount = balance.sub(_balancesBefore[i])
                    _amounts.push(amount)
                    await tokenContracts[i].approve(assetRouter.address, amount, {from: account1})
                }
            })
            it('reverts if minAmountLP is more than recieved amount', async () => {
                await expectRevert(
                    assetRouter.deposit(pool, _amounts, tokens, constants.MAX_UINT256, 0, account1, {from: account1}),
                    "BAL#208"
                )
            })
            it('fires events', async () => {
                const receipt = await assetRouter.deposit(pool, _amounts, tokens, 0, 0, account1, {from: account1})
                expectEvent(receipt, 'Deposit', {lpPool:pool, sender: account1, recipient: account1})
            })
            it('withdraws tokens from balance', async () => {
                for (let i = 0; i < tokenContracts.length; i++){
                    const balanceAfter = await tokenContracts[i].balanceOf(account1)
                    assert.ok((balancesBefore[i].sub(balanceAfter)).gt('0'), "Token not withdrawn");
                }
            })

            let addedStake
            it('updates stakes' ,async () => {
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.ok(stakeLP.gt(amounts[0].add(amounts[1])), "LP stake not increased")
                addedStake = stakeLP.sub(amounts[0].add(amounts[1]))
            })
            it('updates totalDeposits', async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    (amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).add(addedStake)).toString(),
                    "Total amount sent doesn't equal totalDeposits"
                )
            })
            it('stakes tokens in Gauge contract', async () => {
                const stakingRewardBalance = await gauge.balanceOf(farm.address)
                assert.equal(
                    stakingRewardBalance.toString(),
                    (amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).add(addedStake)).toString(),
                    "Total amount sent doesn't equal gauge balance"
                )
            })
        })
    })
    describe('withdraw', () => {
        describe('reverts', () => {
            it('reverts if the pool doesnt exist', async () => {
                await expectRevert(
                    assetRouter.withdraw(pool2, '1', zeroAmounts, true, account1, {from: account1}),
                    "FARM_NOT_EXISTS"
                )
            })
            it('reverts if the stake is zero', async () => {
                await expectRevert(
                    assetRouter.withdraw(pool, '1', zeroAmounts, true, admin, {from: admin}),
                    "INSUFFICIENT_BALANCE"
                )
            })
            it('reverts if the withdraw amount requested is more than user stake', async () => {
                await expectRevert(
                    assetRouter.withdraw(pool, constants.MAX_UINT256, zeroAmounts, true, account1, {from: account1}),
                    "INSUFFICIENT_BALANCE"
                )
            })
            it('reverts if amount provided is 0', async () => {
                await expectRevert(
                    assetRouter.withdraw(pool, 0, zeroAmounts, true, account1, {from: account1}),
                    "INSUFFICIENT_AMOUNT"
                )
            })
        })
        describe('withdraws for multiple accs', () => {
            let balance1before, balance2before
            let stake1before, stake2before

            let receipt1, receipt2

            before(async () => {
                balance1before = await stakingToken.balanceOf(account1)
                balance2before = await stakingToken.balanceOf(account2)

                stake1before = await assetRouter.userStake(account1, pool)
                stake2before = await assetRouter.userStake(account2, pool)
            
                receipt1 = await assetRouter.withdraw(pool, amounts[0], zeroAmounts, true, account1, {from: account1})
                receipt2 = await assetRouter.withdraw(pool, amounts[2], zeroAmounts, true, account2, {from: account2})
            })
            it('fires events', async () => {
                expectEvent(receipt1, 'Withdraw', {lpPool:pool, sender: account1, recipient: account1, amount:amounts[0]})
                expectEvent(receipt2, 'Withdraw', {lpPool:pool, sender: account2, recipient: account2, amount:amounts[2]})
            })
        
            it('correctly updates userStake for account1', async () => {
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    stake1before.sub(amounts[0]).toString(),
                    "Stake is not zero for account1"
                )
            })
            it('correctly updates userStake for account2', async () => {
                const stakeLP = await assetRouter.userStake(account2, pool)
                assert.equal(
                    stakeLP.toString(),
                    stake2before.sub(amounts[2]).toString(),
                    "Stake is not right for account2"
                )
            })
            it('correctly updates totalDeposits', async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    stake1before.sub(amounts[0]).add(stake2before.sub(amounts[2])).toString(),
                    "totalDeposits are not right"
                )
            })
            it('transfers tokens to user', async ()=>{
                const balance1after = await stakingToken.balanceOf(account1)
                assert.equal(
                    (balance1after.sub(balance1before)).toString(),
                    amounts[0].toString(),
                    "Tokens withdrawn for account1 do not equal provided in the withdraw function"
                )
                const balance2after = await stakingToken.balanceOf(account2)
                assert.equal(
                    (balance2after.sub(balance2before)),
                    amounts[2].toString(),
                    "Tokens withdrawn for account2 do not equal provided in the withdraw function"
                )
            })
        })
        describe('withdraws for different acc', () => {
            let balance1before, balance2before
            let stake1before, stake2before

            let receipt
            before(async () => {
                balance1before = await stakingToken.balanceOf(account1);
                balance2before = await stakingToken.balanceOf(account2);

                stake1before = await assetRouter.userStake(account1, pool);
                stake2before = await assetRouter.userStake(account2, pool);
            
                receipt = await assetRouter.withdraw(pool, amounts[1], zeroAmounts, true, account2, {from: account1})
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Withdraw', {lpPool:pool, sender: account1, recipient: account2, amount:amounts[1]})
            })
            it('correctly changes userStake for account1', async () => {
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    (stake1before.sub(amounts[1])).toString(),
                    "Stake is not right for account1"
                )
            })
            it('doesnt change stake for account2', async () => {
                const stakeLP = await assetRouter.userStake(account2, pool)
                assert.equal(
                    stakeLP.toString(),
                    stake2before.toString(),
                    "Stake is not right for account2"
                )
            })
            it('transfers tokens to account2', async ()=>{
                const balance1after = await stakingToken.balanceOf(account1)
                assert.equal(
                    (balance1after.sub(balance1before)).toString(),
                    '0',
                    "Tokens were withdrawn for account1"
                )
                const balance2after = await stakingToken.balanceOf(account2)
                assert.equal(
                    (balance2after.sub(balance2before)).toString(),
                    amounts[1].toString(),
                    "Tokens withdrawn for account2 do not equal provided in the withdraw function"
                )
            })
        })
        describe('withdraws normal tokens', () => {
            let balancesBefore = []
            let stakeLP2, stakeLP1

            let receipt
            before(async () => {
                for (let i = 0; i < tokenContracts.length; i++){
                    balancesBefore.push(await tokenContracts[i].balanceOf(account1))
                }

                stakeLP1 = await assetRouter.userStake(account1, pool);
                stakeLP2 = await assetRouter.userStake(account2, pool);
                receipt = await assetRouter.withdraw(pool, stakeLP1, zeroAmounts, false, account1, {from: account1})
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Withdraw', {lpPool:pool, sender: account1, recipient: account1, amount:stakeLP1})
            })
            it('correctly updates account1 stake', async () => {
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    '0',
                    "stakeLP is wrong"
                )
            })
            it('doesnt update account2 stake', async () => {
                const stakeLP = await assetRouter.userStake(account2, pool)
                assert.equal(
                    stakeLP.toString(),
                    stakeLP2,
                    "stakeLP is wrong"
                )
            })
            it('transfers tokens to user', async ()=>{
                for (let i = 0; i < tokenContracts.length; i++){
                    const balanceAfter = await tokenContracts[i].balanceOf(account1)
                    const delta = balanceAfter.sub(balancesBefore[i])
                    assert.ok(delta.gt('0'), "Token balance not increased")
                }
            })
        })
        describe('withdraws normal tokens for a different user', () => {
            let balancesBefore = []
            let stakeLP1, stakeLP2

            let receipt
            before(async () => {
                for (let i = 0; i < tokenContracts.length; i++){
                    balancesBefore.push(await tokenContracts[i].balanceOf(account1))
                }

                stakeLP1 = await assetRouter.userStake(account1, pool)
                stakeLP2 = await assetRouter.userStake(account2, pool)
                receipt = await assetRouter.withdraw(pool, stakeLP2, zeroAmounts, false, account1, {from: account2})
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Withdraw', {lpPool:pool, sender: account2, recipient: account1, amount:stakeLP2})
            })
            it('correctly updates account2 stake', async () => {
                const stakeLP = await assetRouter.userStake(account2, pool)
                assert.equal(
                    stakeLP.toString(),
                    '0',
                    "stakeLP is wrong"
                )
            })
            it('doesnt update account1 stake', async () => {
                const stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    stakeLP1,
                    "stakeLP is wrong"
                )
            })
            it('transfers tokens to correct user', async ()=>{
                for (let i = 0; i < tokenContracts.length; i++){
                    const balanceAfter = await tokenContracts[i].balanceOf(account1)
                    const delta = balanceAfter.sub(balancesBefore[i])
                    assert.ok(delta.gt('0'), "Token balance not increased")
                }
            })
        })
    })
    describe('Distributions', () => {
        describe('reverts', () => {
            it('reverts if called not by distributor', async () => {
                await expectRevert(
                    assetRouter.distribute(pool, [], [], [], {from: pauser}),
                    "CALLER_NOT_DISTRIBUTOR"
                )
            })
            it('reverts if pool doesnt exist', async () => {
                await expectRevert(
                    assetRouter.distribute(pool2, [], [], [], {from: distributor}),
                    "FARM_NOT_EXISTS"
                )
            })
            it('reverts if there is no liquidity in the pool', async () => {
                await expectRevert(
                    assetRouter.distribute(pool, [], [], [], {from: distributor}),
                    "NO_LIQUIDITY"
                )
            })
        })
        describe('distributes', () => {
            let receipt
            let balance1, balance2
            before(async () => {
                balance1 = await stakingToken.balanceOf(account1)
                await stakingToken.approve(assetRouter.address, balance1, {from: account1})
                await assetRouter.deposit(pool, zeroAmounts, tokens, 0, balance1, account1, {from: account1})

                balance2 = await stakingToken.balanceOf(account2)
                await stakingToken.approve(assetRouter.address, balance2, {from: account2})
                await assetRouter.deposit(pool, zeroAmounts, tokens, 0, balance2, account2, {from: account2})

                await time.increase(50000)

                receipt = await assetRouter.distribute(
                    pool, 
                    [[{"poolId":"0xf461f2240b66d55dcf9059e26c022160c06863bf000100000000000000000006","assetInIndex":0,"assetOutIndex":1,"amount":0,"userData":"0x"}]], //amount can be any number since it is changed to be set to balance in contract
                    [["0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3","0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270"]], //reward token to wmatic
                    [["0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","0"]],
                    {from: distributor}
                )
            })
            it('emits event', async () => {
                expectEvent(receipt, 'Distribute', { lpPool:pool })
            })
            it('increases token stakes', async () => {
                const stake1 = await assetRouter.userStake(account1, pool)
                assert.ok(stake1.gt(balance1), "Stake1 not increased")

                const stake2 = await assetRouter.userStake(account2, pool)
                assert.ok(stake2.gt(balance2), "Stake1 not increased")
            })
        })
        describe('bad path reverts', () => {
            before(async () => {
                await time.increase(50000)
            })
            it('reverts if passed wrong number of params', async() => {
                await expectRevert(
                    assetRouter.distribute(
                        pool, 
                        [[{"poolId":"0xf461f2240b66d55dcf9059e26c022160c06863bf000100000000000000000006","assetInIndex":0,"assetOutIndex":1,"amount":0,"userData":"0x"}],[{"poolId":"0xf461f2240b66d55dcf9059e26c022160c06863bf000100000000000000000006","assetInIndex":0,"assetOutIndex":1,"amount":0,"userData":"0x"}]],
                        [["0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3","0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270"]],
                        [["0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","0"]],
                        {from: distributor}
                    ),
                    "PARAMS_LENGTHS_NOT_MATCH_REWARD_COUNT"
                )
                await expectRevert(
                    assetRouter.distribute(
                        pool, 
                        [[{"poolId":"0xf461f2240b66d55dcf9059e26c022160c06863bf000100000000000000000006","assetInIndex":0,"assetOutIndex":1,"amount":0,"userData":"0x"}]],
                        [["0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3","0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270"], ["0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3","0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270"]],
                        [["0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","0"]],
                        {from: distributor}
                    ),
                    "PARAMS_LENGTHS_NOT_MATCH_REWARD_COUNT"
                )
                await expectRevert(
                    assetRouter.distribute(
                        pool, 
                        [[{"poolId":"0xf461f2240b66d55dcf9059e26c022160c06863bf000100000000000000000006","assetInIndex":0,"assetOutIndex":1,"amount":0,"userData":"0x"}]],
                        [["0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3","0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270"]],
                        [["0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","0"],["0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","0"]],
                        {from: distributor}
                    ),
                    "PARAMS_LENGTHS_NOT_MATCH_REWARD_COUNT"
                )
            })
            it('reverts if assets assetIn is not reward', async() => {
                await expectRevert(
                    assetRouter.distribute(
                        pool, 
                        [[{"poolId":"0xf461f2240b66d55dcf9059e26c022160c06863bf000100000000000000000006","assetInIndex":0,"assetOutIndex":1,"amount":0,"userData":"0x"}]], 
                        [["0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270"]], 
                        [["0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","0"]],
                        {from: distributor}
                    ),
                    "ASSET_NOT_REWARD"
                )
            })
        })
        describe('withdraws', () => {
            it('withdraws all tokens for account1', async () => {
                let stakeLP = await assetRouter.userStake(account1, pool)
                await assetRouter.withdraw(pool, stakeLP, zeroAmounts, true, account1, {from: account1})

                stakeLP = await assetRouter.userStake(account1, pool)
                assert.equal(
                    stakeLP.toString(),
                    '0',
                    "acount1 stake not 0"
                )
            })
            it('withdraws tokens for account2', async () => {
                let stakeLP = await assetRouter.userStake(account2, pool)
                await assetRouter.withdraw(pool, stakeLP, zeroAmounts, true, account2, {from: account2})

                stakeLP = await assetRouter.userStake(account2, pool)
                assert.equal(
                    stakeLP.toString(),
                    '0',
                    "acount2 stake not 0"
                )
            })
            it('not leaves any tokens', async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(pool)
                assert.equal(
                    totalDepositsLP.toString(),
                    '0',
                    "totalDeposits not 0"
                )
            })
        })
    })
    describe('Upgradeability', () => {
        describe('updates', () => {
            let receipt = {}
            before(async () => {
                const instance = await upgradeProxy(assetRouter.address, AssetRouterV2)
                //we get last transaction's hash by finding the last event because upgradeProxy returns contract instance instead of transaction receipt object
                const events = await instance.getPastEvents("AllEvents", {
                    fromBlock: 'latest',
                    toBlock: 'latest'
                })
                const _receipt = await web3.eth.getTransactionReceipt(events[0].transactionHash)
                //convert web3's receipt to truffle's format
                receipt.tx = _receipt.transactionHash
                receipt.receipt = _receipt
                receipt.logs = events

                assetRouter = await AssetRouterV2.at(assetRouter.address)
            })
            it('fires events', async () => {
                expectEvent(receipt, 'Upgraded')
            })
            it('Updates', async ()=>{
                assert.equal(
                    (await assetRouter.version()).toString(),
                    (new BN(2)).toString(),
                    "Contract not updated"
                )
                assert.equal(
                    await assetRouter.farmFactory(),
                    factory.address,
                    "farmFactory changed"
                )
                assert.equal(
                    await assetRouter.accessManager(),
                    accessManager.address,
                    "accessManager changed"
                )
            })
        })
    })
    after(async () => {
        await timeMachine.revertToSnapshot(snapshotId)
    })
})