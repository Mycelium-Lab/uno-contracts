const { expectRevert, expectEvent, BN, constants } = require("@openzeppelin/test-helpers");
const { deployProxy, upgradeProxy } = require("@openzeppelin/truffle-upgrades");

const timeMachine = require("ganache-time-traveler");

// const IStakingRewards = artifacts.require("IStakingRewards");
// const IStakingRewardsFactory = artifacts.require("IStakingRewardsFactory");
const IUniswapV2Pair = artifacts.require("IUniswapV2Pair");
const IUniswapV2Router02 = artifacts.require("IUniswapV2Router02");
const IUniversalMasterChef = artifacts.require("IUniversalMasterChef");
const IERC20 = artifacts.require("IERC20");

const AccessManager = artifacts.require("UnoAccessManager");
const FarmFactory = artifacts.require("UnoFarmFactory");

const Farm = artifacts.require("UnoFarmTrisolarisStandard");
const AssetRouter = artifacts.require("UnoAssetRouterTrisolarisStandard");
const AssetRouterV2 = artifacts.require("UnoAssetRouterTrisolarisStandardV2");

const trisolarisRouter = "0x2CB45Edb4517d5947aFdE3BEAbF95A582506858B";
const pool = "0x2fe064B6c7D274082aa5d2624709bC9AE7D16C77"; // USDC-USDT pool
const pool2 = "0x03B666f3488a7992b2385B12dF7f35156d7b29cD"; // wNEAR-USDT pool

const masterChefV1 = "0x1f1Ed214bef5E83D8f5d0eB5D7011EB965D0D79B";
const masterChefV2 = "0x3838956710bcc9D122Dd23863a0549ca8D5675D6";

const account1 = "0x631A44F635c8fF85848324Be5F8f5aCbed0b9ce5"; // has to be unlocked
const account2 = "0xe73AAF36edd9BDE33DBf9eb42047d326333319e0"; // has to be unlocked

const amounts = [new BN(1000), new BN(3000), new BN(500), new BN(2500), new BN(52792912217)];

approxeq = function (bn1, bn2, epsilon, message) {
    const amountDelta = bn1.sub(bn2).add(epsilon);
    assert.ok(!amountDelta.isNeg(), message);
};
advanceBlocksAndTime = async function (blocks, time) {
    for (let i = 0; i <= blocks; i++) {
        await timeMachine.advanceTimeAndBlock(time);
    }
};

contract("UnoAssetRouterTrisolarisStandard", accounts => {
    const admin = accounts[0];
    const pauser = accounts[1];
    const distributor = accounts[2];

    let accessManager, assetRouter, factory;

    // let stakingRewards, stakingToken;
    let snapshotId;

    let rewardTokenAddress, rewarderTokenAddress;

    let MasterChef;

    let pid;

    let lpToken;

    let tokenA, tokenB;

    let initReceipt = {};
    before(async () => {
        const snapshot = await timeMachine.takeSnapshot();
        snapshotId = snapshot["result"];

        const implementation = await Farm.new({ from: account1 });
        accessManager = await AccessManager.new({ from: admin }); //accounts[0] is admin

        await accessManager.grantRole(
            "0xfbd454f36a7e1a388bd6fc3ab10d434aa4578f811acbbcf33afb1c697486313c",
            distributor,
            { from: admin },
        ); //DISTRIBUTOR_ROLE
        await accessManager.grantRole(
            "0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a",
            pauser,
            { from: admin },
        ); //PAUSER_ROLE

        assetRouter = await deployProxy(AssetRouter, { kind: "uups", initializer: false });

        factory = await FarmFactory.new(
            implementation.address,
            accessManager.address,
            assetRouter.address,
            { from: account1 },
        );

        const _receipt = await web3.eth.getTransactionReceipt(factory.transactionHash);
        const events = await assetRouter.getPastEvents("AllEvents", {
            fromBlock: _receipt.block,
            toBlock: _receipt.block,
        });
        //convert web3's receipt to truffle's format
        initReceipt.tx = _receipt.transactionHash;
        initReceipt.receipt = _receipt;
        initReceipt.logs = events;

        const MasterChefV1 = await IUniversalMasterChef.at(masterChefV1);
        const MasterChefV2 = await IUniversalMasterChef.at(masterChefV2);

        const poolLengthV1 = (await MasterChefV1.poolLength()).toNumber();
        const poolLengthV2 = (await MasterChefV2.poolLength()).toNumber();

        let poolFound = false;

        for (let i = 0; i < poolLengthV2; i++) {
            const lpToken = await MasterChefV2.lpToken(i);
            if (lpToken.toString() === pool) {
                pid = i;
                poolFound = true;
                masterChefType = 2;
                break;
            }
        }

        if (!poolFound) {
            for (let i = 0; i < poolLengthV1; i++) {
                const lpToken = (await MasterChefV1.poolInfo(i))["0"];
                if (lpToken.toString() === pool) {
                    pid = i;
                    poolFound = true;
                    masterChefType = 1;
                    break;
                }
            }
        }

        MasterChef = masterChefType === 1 ? MasterChefV1 : MasterChefV2;

        rewardTokenAddress =
            masterChefType === 1
                ? (await MasterChef.tri()).toString()
                : (await MasterChef.TRI()).toString();

        const complexRewarder = (await MasterChef.rewarder(pid)).toString();

        if (complexRewarder != constants.ZERO_ADDRESS) {
            const ComplexRewarder = await IComplexRewarder.at(complexRewarder);
            const data = await ComplexRewarder.pendingTokens(pid, constants.ZERO_ADDRESS, 0);
            rewarderTokenAddress = data["0"]["0"].toString();
        } else {
            rewarderTokenAddress = constants.ZERO_ADDRESS;
        }

        lpToken = await IUniswapV2Pair.at(pool);

        const tokenAAddress = (await lpToken.token0()).toString();
        const tokenBAddress = (await lpToken.token1()).toString();

        tokenA = await IERC20.at(tokenAAddress);
        tokenB = await IERC20.at(tokenBAddress);

        stakingToken = await IERC20.at(pool);
    });

    describe("Emits initialize event", () => {
        it("fires events", async () => {
            expectEvent(initReceipt, "Initialized", { version: new BN(1) });
        });
    });

    describe("Can't call multiple initializations", () => {
        it("Reverts", async () => {
            await expectRevert(
                assetRouter.initialize(accessManager.address, factory.address, { from: account1 }),
                "Initializable: contract is already initialized",
            );
        });
    });

    describe("Initializes variables", () => {
        it("Inits pausable ", async () => {
            assert.equal(await assetRouter.paused(), false, "Pausable not initialized");
        });
        it("Sets accessManager", async () => {
            assert.equal(
                await assetRouter.accessManager(),
                accessManager.address,
                "accessManager not set",
            );
        });

        it("Sets farmFactory", async () => {
            assert.equal(await assetRouter.farmFactory(), factory.address, "farmFactory not set");
        });
    });

    describe("getTokens", () => {
        let _tokenA, _tokenB;
        before(async () => {
            ({ tokenA: _tokenA, tokenB: _tokenB } = await assetRouter.getTokens(pool));
        });
        it("TokenA is correct", async () => {
            assert.equal(_tokenA, tokenA.address, "TokenA is not correct");
        });
        it("TokenB is correct", async () => {
            assert.equal(_tokenB, tokenB.address, "TokenB is not correct");
        });
    });

    describe("Pausable", () => {
        describe("reverts", () => {
            it("reverts if called not by a pauser", async () => {
                await expectRevert(assetRouter.pause({ from: account1 }), "CALLER_NOT_PAUSER");
                await expectRevert(assetRouter.unpause({ from: account1 }), "CALLER_NOT_PAUSER");
            });
        });

        describe("pauses", () => {
            let receipt;
            before(async () => {
                receipt = await assetRouter.pause({ from: pauser });
            });
            it("fires events", async () => {
                expectEvent(receipt, "Paused", { account: pauser });
            });
            it("switches paused state", async () => {
                assert.equal(await assetRouter.paused(), true, "Not paused");
            });
            it("prevents function calls", async () => {
                await expectRevert(
                    assetRouter.deposit(pool, 0, 0, 0, 0, 0, account1, { from: account1 }),
                    "Pausable: paused",
                );
                await expectRevert(
                    assetRouter.withdraw(pool, 0, 0, 0, false, account1, { from: account1 }),
                    "Pausable: paused",
                );
                await expectRevert(
                    assetRouter.distribute(pool, [], [], [], [], [0, 0, 0, 0], { from: account1 }),
                    "Pausable: paused",
                );
            });
            it("reverts if called pause on paused contract", async () => {
                await expectRevert(assetRouter.pause({ from: pauser }), "Pausable: paused");
            });
        });

        describe("unpauses", () => {
            let receipt;
            before(async () => {
                receipt = await assetRouter.unpause({ from: pauser });
            });
            it("fires events", async () => {
                expectEvent(receipt, "Unpaused", { account: pauser });
            });
            it("switches paused state", async () => {
                assert.equal(await assetRouter.paused(), false, "Paused");
            });
            it("allows function calls", async () => {
                //Pausable: paused check passes. revert for a different reason
                await expectRevert(
                    assetRouter.deposit(pool, 0, 0, 0, 0, 0, account1, { from: account1 }),
                    "NO_LIQUIDITY_PROVIDED",
                );
                await expectRevert(
                    assetRouter.withdraw(pool, 0, 0, 0, false, account1, { from: account1 }),
                    "FARM_NOT_EXISTS",
                );
                await expectRevert(
                    assetRouter.distribute(pool, [], [], [], [], [0, 0, 0, 0], { from: account1 }),
                    "CALLER_NOT_DISTRIBUTOR",
                );
            });
            it("reverts if called unpause on unpaused contract", async () => {
                await expectRevert(assetRouter.unpause({ from: pauser }), "Pausable: not paused");
            });
        });
    });

    let farm;
    describe("Deposits", () => {
        describe("reverts", () => {
            it("reverts if total amount provided is zero", async () => {
                await expectRevert(
                    assetRouter.deposit(pool, 0, 0, 0, 0, 0, account1, { from: account1 }),
                    "NO_LIQUIDITY_PROVIDED",
                );
            });
        });
        describe("deposit lp tokens in new pool", () => {
            let receipt;
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[0], { from: account1 });
                receipt = await assetRouter.deposit(pool, 0, 0, 0, 0, amounts[0], account1, {
                    from: account1,
                });

                const farmAddress = await factory.Farms(pool);
                farm = await Farm.at(farmAddress);
            });
            it("fires events", async () => {
                expectEvent(receipt, "Deposit", {
                    lpPool: pool,
                    from: account1,
                    recipient: account1,
                    amount: amounts[0],
                });
            });
            it("updates stakes", async () => {
                const { stakeLP } = await assetRouter.userStake(account1, pool);
                assert.equal(
                    stakeLP.toString(),
                    amounts[0].toString(),
                    "Amount sent doesn't equal userStake",
                );
            });
            it("updates totalDeposits", async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool);
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].toString(),
                    "Total amount sent doesn't equal totalDeposits",
                );
            });
            it("stakes tokens in StakingRewards contract", async () => {
                assert.equal(
                    (await MasterChef.userInfo(pid, farm.address))["0"].toString(),
                    amounts[0].toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance",
                );
            });
        });
        describe("deposits from the same account add up", () => {
            let receipt;
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[1], { from: account1 });
                receipt = await assetRouter.deposit(pool, 0, 0, 0, 0, amounts[1], account1, {
                    from: account1,
                });
            });
            it("fires events", async () => {
                expectEvent(receipt, "Deposit", {
                    lpPool: pool,
                    from: account1,
                    recipient: account1,
                    amount: amounts[1],
                });
            });
            it("updates stakes", async () => {
                const { stakeLP } = await assetRouter.userStake(account1, pool);
                assert.equal(
                    stakeLP.toString(),
                    amounts[0].add(amounts[1]).toString(),
                    "Amount sent doesn't equal userStake",
                );
            });
            it("updates totalDeposits", async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool);
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].add(amounts[1]).toString(),
                    "Total amount sent doesn't equal totalDeposits",
                );
            });
            it("stakes tokens in StakingRewards contract", async () => {
                assert.equal(
                    (await MasterChef.userInfo(pid, farm.address))["0"].toString(),
                    amounts[0].add(amounts[1]).toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance",
                );
            });
        });
        describe("deposit lp tokens from different account", () => {
            let receipt;
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[2], { from: account2 });
                receipt = await assetRouter.deposit(pool, 0, 0, 0, 0, amounts[2], account2, {
                    from: account2,
                });
            });
            it("fires events", async () => {
                expectEvent(receipt, "Deposit", {
                    lpPool: pool,
                    from: account2,
                    recipient: account2,
                    amount: amounts[2],
                });
            });
            it("doesn't change stakes for account[0]", async () => {
                const { stakeLP } = await assetRouter.userStake(account1, pool);
                assert.equal(
                    stakeLP.toString(),
                    amounts[0].add(amounts[1]).toString(),
                    "Amount sent changed userStake for account1",
                );
            });
            it("updates stakes for account[1]", async () => {
                const { stakeLP } = await assetRouter.userStake(account2, pool);
                assert.equal(
                    stakeLP.toString(),
                    amounts[2].toString(),
                    "Amount sent doesn't equal userStake",
                );
            });
            it("updates totalDeposits", async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool);
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].add(amounts[1]).add(amounts[2]).toString(),
                    "Total amount sent doesn't equal totalDeposits",
                );
            });
            it("stakes tokens in StakingRewards contract", async () => {
                assert.equal(
                    (await MasterChef.userInfo(pid, farm.address))["0"].toString(),
                    amounts[0].add(amounts[1]).add(amounts[2]).toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance",
                );
            });
        });
        describe("deposit lp tokens for different user", () => {
            let receipt;
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[3], { from: account1 });
                receipt = await assetRouter.deposit(pool, 0, 0, 0, 0, amounts[3], account2, {
                    from: account1,
                });
            });
            it("fires event", async () => {
                expectEvent(receipt, "Deposit", {
                    lpPool: pool,
                    from: account1,
                    recipient: account2,
                    amount: amounts[3],
                });
            });
            it("doesnt change stakes for account1", async () => {
                const { stakeLP } = await assetRouter.userStake(account1, pool);
                assert.equal(
                    stakeLP.toString(),
                    amounts[0].add(amounts[1]).toString(),
                    "stakeLP is not 0",
                );
            });
            it("updates stakes for account2", async () => {
                const { stakeLP } = await assetRouter.userStake(account2, pool);
                assert.equal(
                    stakeLP.toString(),
                    amounts[2].add(amounts[3]).toString(),
                    "Amount sent doesn't equal userStake",
                );
            });
            it("updates totalDeposits", async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool);
                assert.equal(
                    totalDepositsLP.toString(),
                    amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).toString(),
                    "Total amount sent doesn't equal totalDeposits",
                );
            });
            it("stakes tokens in StakingRewards contract", async () => {
                assert.equal(
                    (await MasterChef.userInfo(pid, farm.address))["0"].toString(),
                    amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).toString(),
                    "Total amount sent doesn't equal StakingRewards farm balance",
                );
            });
        });
        describe("deposit normal tokens", () => {
            let balanceAbefore, balanceBbefore;
            let stakeABefore, stakeBBefore;

            let amountA, amountB;

            let receipt;

            before(async () => {
                const routerContract = await IUniswapV2Router02.at(trisolarisRouter);
                await stakingToken.approve(trisolarisRouter, amounts[4], {
                    from: account1,
                });
                const tx = await routerContract.removeLiquidity(
                    tokenA.address,
                    tokenB.address,
                    amounts[4],
                    1,
                    1,
                    account1,
                    "16415710000",
                    { from: account1 },
                );
                const event = tx.receipt.rawLogs.find(l => {
                    return (
                        l.topics[0] ==
                        "0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496"
                    );
                });

                amountA = web3.utils.hexToNumberString(event.data.substring(0, 66));
                amountB = web3.utils.hexToNumberString("0x" + event.data.substring(66, 130));

                balanceAbefore = await tokenA.balanceOf(account1);
                balanceBbefore = await tokenB.balanceOf(account1);
                ({
                    stakeLP,
                    stakeA: stakeABefore,
                    stakeB: stakeBBefore,
                } = await assetRouter.userStake(account1, pool));

                await tokenA.approve(assetRouter.address, amountA, { from: account1 });
                await tokenB.approve(assetRouter.address, amountB, { from: account1 });
            });
            it("reverts if minAmountA > amountA || minAmountB > amountB", async () => {
                await expectRevert(
                    assetRouter.deposit(pool, amountA, new BN(1), amountA, 0, 0, account1, {
                        from: account1,
                    }),
                    "INSUFFICIENT_A_AMOUNT",
                );
                await expectRevert(
                    assetRouter.deposit(pool, new BN(1), amountB, 0, amountB, 0, account1, {
                        from: account1,
                    }),
                    "INSUFFICIENT_B_AMOUNT",
                );
            });
            it("fires events", async () => {
                receipt = await assetRouter.deposit(pool, amountA, amountB, 0, 0, 0, account1, {
                    from: account1,
                });
                expectEvent(receipt, "Deposit", {
                    lpPool: pool,
                    from: account1,
                    recipient: account1,
                });
            });
            it("withdraws tokens from balance", async () => {
                const { stakeA, stakeB } = await assetRouter.userStake(account1, pool);
                const balanceAafter = await tokenA.balanceOf(account1);
                const balanceBafter = await tokenB.balanceOf(account1);

                approxeq(
                    stakeA.sub(stakeABefore),
                    balanceAbefore.sub(balanceAafter),
                    new BN(1),
                    "StakeA is not correct",
                );
                approxeq(
                    stakeB.sub(stakeBBefore),
                    balanceBbefore.sub(balanceBafter),
                    new BN(1),
                    "StakeB is not correct",
                );
            });
            it("updates stakes", async () => {
                const { stakeLP } = await assetRouter.userStake(account1, pool);
                approxeq(
                    stakeLP,
                    amounts[0].add(amounts[1]).add(amounts[4]),
                    new BN(10),
                    "LP Amount sent doesn't equal userStake",
                );
            });
            it("updates totalDeposits", async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool);
                approxeq(
                    totalDepositsLP,
                    amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).add(amounts[4]),
                    new BN(10),
                    "Total amount sent doesn't equal totalDeposits",
                );
            });
            it("stakes tokens in StakingRewards contract", async () => {
                approxeq(
                    new BN((await MasterChef.userInfo(pid, farm.address))["0"].toString()),
                    amounts[0].add(amounts[1]).add(amounts[2]).add(amounts[3]).add(amounts[4]),
                    new BN(10),
                    "Total amount sent doesn't equal totalDeposits",
                );
            });
        });
    });
    describe("withdraw", () => {
        describe("reverts", () => {
            it("reverts if the pool doesnt exist", async () => {
                await expectRevert(
                    assetRouter.withdraw(pool2, amounts[0], 0, 0, true, account1, {
                        from: account1,
                    }),
                    "FARM_NOT_EXISTS",
                );
            });
            it("reverts if the stake is zero", async () => {
                await expectRevert.unspecified(
                    assetRouter.withdraw(pool, new BN(1), 0, 0, true, admin, { from: admin }),
                );
            });
            it("reverts if the withdraw amount requested is more than user stake", async () => {
                await expectRevert.unspecified(
                    assetRouter.withdraw(pool, constants.MAX_UINT256, 0, 0, true, account1, {
                        from: account1,
                    }),
                );
            });
            it("reverts if amount provided is 0", async () => {
                await expectRevert(
                    assetRouter.withdraw(pool, 0, 0, 0, true, account1, { from: account1 }),
                    "INSUFFICIENT_AMOUNT",
                );
            });
        });
        describe("withdraws for multiple accs", () => {
            let balance1before, balance2before;
            let stake1before, stake2before;

            let receipt1, receipt2;

            before(async () => {
                balance1before = await stakingToken.balanceOf(account1);
                balance2before = await stakingToken.balanceOf(account2);

                ({ stakeLP: stake1before } = await assetRouter.userStake(account1, pool));
                ({ stakeLP: stake2before } = await assetRouter.userStake(account2, pool));

                receipt1 = await assetRouter.withdraw(pool, amounts[0], 0, 0, true, account1, {
                    from: account1,
                });
                receipt2 = await assetRouter.withdraw(pool, amounts[2], 0, 0, true, account2, {
                    from: account2,
                });
            });
            it("fires events", async () => {
                expectEvent(receipt1, "Withdraw", {
                    lpPool: pool,
                    from: account1,
                    recipient: account1,
                    amount: amounts[0],
                });
                expectEvent(receipt2, "Withdraw", {
                    lpPool: pool,
                    from: account2,
                    recipient: account2,
                    amount: amounts[2],
                });
            });

            it("correctly updates userStake for account1", async () => {
                const { stakeLP } = await assetRouter.userStake(account1, pool);
                assert.equal(
                    stakeLP.toString(),
                    stake1before.sub(amounts[0]).toString(),
                    "Stake is not zero for account1",
                );
            });
            it("correctly updates userStake for account2", async () => {
                const { stakeLP } = await assetRouter.userStake(account2, pool);
                assert.equal(
                    stakeLP.toString(),
                    stake2before.sub(amounts[2]).toString(),
                    "Stake is not right for account2",
                );
            });
            it("correctly updates totalDeposits", async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool);
                assert.equal(
                    totalDepositsLP.toString(),
                    stake1before.sub(amounts[0]).add(stake2before.sub(amounts[2])).toString(),
                    "totalDeposits are not right",
                );
            });
            it("transfers tokens to user", async () => {
                const balance1after = await stakingToken.balanceOf(account1);
                assert.equal(
                    balance1after.sub(balance1before).toString(),
                    amounts[0].toString(),
                    "Tokens withdrawn for account1 do not equal provided in the withdraw function",
                );
                const balance2after = await stakingToken.balanceOf(account2);
                assert.equal(
                    balance2after.sub(balance2before),
                    amounts[2].toString(),
                    "Tokens withdrawn for account2 do not equal provided in the withdraw function",
                );
            });
        });
        describe("withdraws for different acc", () => {
            let balance1before, balance2before;
            let stake1before, stake2before;

            let receipt;
            before(async () => {
                balance1before = await stakingToken.balanceOf(account1);
                balance2before = await stakingToken.balanceOf(account2);

                ({ stakeLP: stake1before } = await assetRouter.userStake(account1, pool));
                ({ stakeLP: stake2before } = await assetRouter.userStake(account2, pool));

                receipt = await assetRouter.withdraw(pool, amounts[1], 0, 0, true, account2, {
                    from: account1,
                });
            });
            it("fires events", async () => {
                expectEvent(receipt, "Withdraw", {
                    lpPool: pool,
                    from: account1,
                    recipient: account2,
                    amount: amounts[1],
                });
            });
            it("correctly changes userStake for account1", async () => {
                const { stakeLP } = await assetRouter.userStake(account1, pool);
                assert.equal(
                    stakeLP.toString(),
                    stake1before.sub(amounts[1]).toString(),
                    "Stake is not right for account1",
                );
            });
            it("doesnt change stake for account2", async () => {
                const { stakeLP } = await assetRouter.userStake(account2, pool);
                assert.equal(
                    stakeLP.toString(),
                    stake2before.toString(),
                    "Stake is not right for account2",
                );
            });
            it("transfers tokens to account2", async () => {
                const balance1after = await stakingToken.balanceOf(account1);
                assert.equal(
                    balance1after.sub(balance1before).toString(),
                    "0",
                    "Tokens were withdrawn for account1",
                );
                const balance2after = await stakingToken.balanceOf(account2);
                assert.equal(
                    balance2after.sub(balance2before).toString(),
                    amounts[1].toString(),
                    "Tokens withdrawn for account2 do not equal provided in the withdraw function",
                );
            });
        });
        describe("withdraws normal tokens", () => {
            let balanceAbefore, balanceBbefore;

            let stakeLP1, stakeA1, stakeB1;
            let stakeLP2, stakeA2, stakeB2;

            let receipt;
            before(async () => {
                balanceAbefore = await tokenA.balanceOf(account1);
                balanceBbefore = await tokenB.balanceOf(account1);

                ({
                    stakeLP: stakeLP1,
                    stakeA: stakeA1,
                    stakeB: stakeB1,
                } = await assetRouter.userStake(account1, pool));
                ({
                    stakeLP: stakeLP2,
                    stakeA: stakeA2,
                    stakeB: stakeB2,
                } = await assetRouter.userStake(account2, pool));
                receipt = await assetRouter.withdraw(pool, stakeLP1, 0, 0, false, account1, {
                    from: account1,
                });
            });
            it("fires events", async () => {
                expectEvent(receipt, "Withdraw", {
                    lpPool: pool,
                    from: account1,
                    recipient: account1,
                    amount: stakeLP1,
                });
            });
            it("correctly updates account1 stake", async () => {
                const { stakeLP, stakeA, stakeB } = await assetRouter.userStake(account1, pool);
                assert.equal(stakeLP.toString(), "0", "stakeLP is wrong");
                assert.equal(stakeA.toString(), "0", "stakeA is wrong");
                assert.equal(stakeB.toString(), "0", "stakeB is wrong");
            });
            it("doesnt update account2 stake", async () => {
                const { stakeLP, stakeA, stakeB } = await assetRouter.userStake(account2, pool);
                assert.equal(stakeLP.toString(), stakeLP2, "stakeLP is wrong");
                assert.equal(stakeA.toString(), stakeA2, "stakeA is wrong");
                assert.equal(stakeB.toString(), stakeB2, "stakeB is wrong");
            });
            it("transfers tokens to user", async () => {
                const balanceAafter = await tokenA.balanceOf(account1);
                assert.equal(
                    balanceAafter.sub(balanceAbefore).toString(),
                    stakeA1.toString(),
                    "TokensA withdrawn do not equal deposited",
                );

                const balanceBafter = await tokenB.balanceOf(account1);
                assert.equal(
                    balanceBafter.sub(balanceBbefore).toString(),
                    stakeB1.toString(),
                    "TokensB withdrawn do not equal deposited",
                );
            });
        });
        describe("withdraws normal tokens for a different user", () => {
            let balanceAbefore, balanceBbefore;

            let stakeLP2, stakeA2, stakeB2;
            let stakeLP1, stakeA1, stakeB1;

            let receipt;
            before(async () => {
                balanceAbefore = await tokenA.balanceOf(account1);
                balanceBbefore = await tokenB.balanceOf(account1);

                ({
                    stakeLP: stakeLP1,
                    stakeA: stakeA1,
                    stakeB: stakeB1,
                } = await assetRouter.userStake(account1, pool));
                ({
                    stakeLP: stakeLP2,
                    stakeA: stakeA2,
                    stakeB: stakeB2,
                } = await assetRouter.userStake(account2, pool));
                receipt = await assetRouter.withdraw(pool, stakeLP2, 0, 0, false, account1, {
                    from: account2,
                });
            });
            it("fires events", async () => {
                expectEvent(receipt, "Withdraw", {
                    lpPool: pool,
                    from: account2,
                    recipient: account1,
                    amount: stakeLP2,
                });
            });
            it("correctly updates account2 stake", async () => {
                const { stakeLP, stakeA, stakeB } = await assetRouter.userStake(account2, pool);
                assert.equal(stakeLP.toString(), "0", "stakeLP is wrong");
                assert.equal(stakeA.toString(), "0", "stakeA is wrong");
                assert.equal(stakeB.toString(), "0", "stakeB is wrong");
            });
            it("doesnt update account1 stake", async () => {
                const { stakeLP, stakeA, stakeB } = await assetRouter.userStake(account1, pool);
                assert.equal(stakeLP.toString(), stakeLP1, "stakeLP is wrong");
                assert.equal(stakeA.toString(), stakeA1, "stakeA is wrong");
                assert.equal(stakeB.toString(), stakeB1, "stakeB is wrong");
            });
            it("transfers tokens to correct user", async () => {
                const balanceAafter = await tokenA.balanceOf(account1);
                assert.equal(
                    balanceAafter.sub(balanceAbefore).toString(),
                    stakeA2.toString(),
                    "TokensA withdrawn do not equal deposited",
                );

                const balanceBafter = await tokenB.balanceOf(account1);
                assert.equal(
                    balanceBafter.sub(balanceBbefore).toString(),
                    stakeB2.toString(),
                    "TokensB withdrawn do not equal deposited",
                );
            });
        });
    });
    describe("Distributions", () => {
        describe("reverts", () => {
            it("reverts if called not by distributor", async () => {
                await expectRevert(
                    assetRouter.distribute(pool, [], [], [], [], [0, 0, 0, 0], { from: pauser }),
                    "CALLER_NOT_DISTRIBUTOR",
                );
            });
            it("reverts if pool doesnt exist", async () => {
                await expectRevert(
                    assetRouter.distribute(pool2, [], [], [], [], [0, 0, 0, 0], {
                        from: distributor,
                    }),
                    "FARM_NOT_EXISTS",
                );
            });
            it("reverts if there is no liquidity in the pool", async () => {
                await expectRevert(
                    assetRouter.distribute(pool, [], [], [], [], [0, 0, 0, 0], {
                        from: distributor,
                    }),
                    "NO_LIQUIDITY",
                );
            });
        });
        describe("distributes", () => {
            let receipt;
            let balance1, balance2;
            before(async () => {
                balance1 = await stakingToken.balanceOf(account1);
                await stakingToken.approve(assetRouter.address, balance1, { from: account1 });
                await assetRouter.deposit(pool, 0, 0, 0, 0, balance1, account1, { from: account1 });

                balance2 = await stakingToken.balanceOf(account2);
                await stakingToken.approve(assetRouter.address, balance2, { from: account2 });
                await assetRouter.deposit(pool, 0, 0, 0, 0, balance2, account2, { from: account2 });

                await timeMachine.advanceTimeAndBlock(1000);

                receipt = await assetRouter.distribute(
                    pool,
                    [
                        "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                        "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                        "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                        "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                    ],
                    [
                        "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                        "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                    ],
                    [constants.ZERO_ADDRESS, "0x4988a896b1227218e4A686fdE5EabdcAbd91571f"],
                    [constants.ZERO_ADDRESS, "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802"],
                    [1, 1, 1, 1],
                    { from: distributor },
                );
            });
            it("emits event", async () => {
                expectEvent(receipt, "Distribute", { lpPool: pool });
            });
            it("increases token stakes", async () => {
                const { stakeLP: stake1 } = await assetRouter.userStake(account1, pool);
                assert.isAbove(stake1.toNumber(), balance1.toNumber(), "Stake1 not increased");

                const { stakeLP: stake2 } = await assetRouter.userStake(account2, pool);
                assert.isAbove(stake2.toNumber(), balance2.toNumber(), "Stake2 not increased");
            });
        });
        describe("bad path reverts", () => {
            it("reverts if passed wrong reward token", async () => {
                await expectRevert(
                    assetRouter.distribute(
                        pool,
                        [
                            "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                            "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                        ],
                        [
                            "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                            "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                        ],
                        [constants.ZERO_ADDRESS, "0x4988a896b1227218e4A686fdE5EabdcAbd91571f"],
                        [constants.ZERO_ADDRESS, "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802"],
                        [1, 1, 1, 1],
                        { from: distributor },
                    ),
                    "BAD_REWARD_TOKEN_A_ROUTE",
                );
                await expectRevert(
                    assetRouter.distribute(
                        pool,
                        [
                            "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                            "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                            "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                        ],
                        [
                            "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                        ],
                        [constants.ZERO_ADDRESS, "0x4988a896b1227218e4A686fdE5EabdcAbd91571f"],
                        [constants.ZERO_ADDRESS, "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802"],
                        [1, 1, 1, 1],
                        { from: distributor },
                    ),
                    "BAD_REWARD_TOKEN_B_ROUTE",
                );
            });
            it("reverts if passed wrong tokenA", async () => {
                await expectRevert(
                    assetRouter.distribute(
                        pool,
                        [
                            "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                            "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                            "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                        ],
                        [
                            "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                            "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                        ],
                        [constants.ZERO_ADDRESS, "0x4988a896b1227218e4A686fdE5EabdcAbd91571f"],
                        [constants.ZERO_ADDRESS, "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802"],
                        [1, 1, 1, 1],
                        { from: distributor },
                    ),
                    "BAD_REWARD_TOKEN_A_ROUTE",
                );
            });
            it("reverts if passed wrong tokenB", async () => {
                await expectRevert(
                    assetRouter.distribute(
                        pool,
                        [
                            "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                            "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                            "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                        ],
                        [
                            "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                            "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                        ],
                        [constants.ZERO_ADDRESS, "0x4988a896b1227218e4A686fdE5EabdcAbd91571f"],
                        [constants.ZERO_ADDRESS, "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802"],
                        [1, 1, 1, 1],
                        { from: distributor },
                    ),
                    "BAD_REWARD_TOKEN_B_ROUTE",
                );
            });
        });
        describe("withdraws", () => {
            it("withdraws all tokens for account1", async () => {
                let { stakeLP } = await assetRouter.userStake(account1, pool);
                await assetRouter.withdraw(pool, stakeLP, 0, 0, true, account1, { from: account1 });

                ({ stakeLP } = await assetRouter.userStake(account1, pool));
                assert.equal(stakeLP.toString(), "0", "acount1 stake not 0");
            });
            it("withdraws tokens for account2", async () => {
                let { stakeLP } = await assetRouter.userStake(account2, pool);
                await assetRouter.withdraw(pool, stakeLP, 0, 0, true, account2, { from: account2 });

                ({ stakeLP } = await assetRouter.userStake(account2, pool));
                assert.equal(stakeLP.toString(), "0", "acount2 stake not 0");
            });
            it("not leaves any tokens", async () => {
                const { totalDepositsLP } = await assetRouter.totalDeposits(pool);
                assert.equal(totalDepositsLP.toString(), "0", "totalDeposits not 0");
            });
        });
    });
    describe("Upgradeability", () => {
        describe("updates", () => {
            let receipt = {};
            before(async () => {
                const instance = await upgradeProxy(assetRouter.address, AssetRouterV2);
                //we get last transaction's hash by finding the last event because upgradeProxy returns contract instance instead of transaction receipt object
                const events = await instance.getPastEvents("AllEvents", {
                    fromBlock: "latest",
                    toBlock: "latest",
                });
                const _receipt = await web3.eth.getTransactionReceipt(events[0].transactionHash);
                //convert web3's receipt to truffle's format
                receipt.tx = _receipt.transactionHash;
                receipt.receipt = _receipt;
                receipt.logs = events;

                assetRouter = await AssetRouterV2.at(assetRouter.address);
            });
            it("fires events", async () => {
                expectEvent(receipt, "Upgraded");
            });
            it("Updates", async () => {
                assert.equal(
                    (await assetRouter.version()).toString(),
                    new BN(2).toString(),
                    "Contract not updated",
                );
                assert.equal(
                    await assetRouter.farmFactory(),
                    factory.address,
                    "farmFactory changed",
                );
                assert.equal(
                    await assetRouter.accessManager(),
                    accessManager.address,
                    "accessManager changed",
                );
            });
        });
    });
    after(async () => {
        await timeMachine.revertToSnapshot(snapshotId);
    });
});
