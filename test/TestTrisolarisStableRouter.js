const { expectRevert, expectEvent, BN, constants } = require("@openzeppelin/test-helpers");
const { deployProxy, upgradeProxy } = require("@openzeppelin/truffle-upgrades");

const timeMachine = require("ganache-time-traveler");

const IUniversalMasterChef = artifacts.require("IUniversalMasterChef");
const IComplexRewarder = artifacts.require("IComplexRewarder");
const IERC20 = artifacts.require("IERC20");
const ISwap = artifacts.require("ISwap");

const AccessManager = artifacts.require("UnoAccessManager");
const FarmFactory = artifacts.require("UnoFarmFactory");

const Farm = artifacts.require("UnoFarmTrisolarisStable");
const AssetRouter = artifacts.require("UnoAssetRouterTrisolarisStable");
const AssetRouterV2 = artifacts.require("UnoAssetRouterTrisolarisStableV2");

const swapAddress = "0x458459E48dbAC0C8Ca83F8D0b7b29FEfE60c3970"; // USDC-USDT-USN
const swap2Address = "0x13e7a001EC72AB30D66E2f386f677e25dCFF5F59"; // wNEAR-USDT pool

const lpTokenAddress = "0x87BCC091d0A7F9352728100268Ac8D25729113bB";

const poolTokensAddresses = [
    "0xb12bfca5a55806aaf64e99521918a4bf0fc40802",
    "0x4988a896b1227218e4a686fde5eabdcabd91571f",
    "0x5183e1b1091804bc2602586919e6880ac1cf2896",
]; // USDC, USDT, USN (in that order)

const masterChefV2 = "0x3838956710bcc9D122Dd23863a0549ca8D5675D6";

const account1 = "0xAE205662f4C14E062E7d8575554385B38BA14c2E"; // has to be unlocked
const account2 = "0x949b82Dfc04558bC4D3CA033A1B194915a3A3bEE"; // has to be unlocked
const accountNormalTokens = "0x173c35e1D60f061F2Fd4a0C4a881119d39D51E7a"; // has to be unlocked

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

contract("UnoAssetRouterTrisolarisStable", accounts => {
    const admin = accounts[0];
    const pauser = accounts[1];
    const distributor = accounts[2];

    let accessManager, assetRouter, factory;
    let stakingToken;
    let snapshotId;
    let MasterChef;
    let pid;
    let Swap;

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

        MasterChef = await IUniversalMasterChef.at(masterChefV2);

        const poolLengthV2 = await MasterChef.poolLength();

        for (let i = 0; i < poolLengthV2.toNumber(); i++) {
            const lpToken = await MasterChef.lpToken(i);
            if (lpToken.toString() === lpTokenAddress) {
                pid = i;
                break;
            }
        }

        rewardTokenAddress = (await MasterChef.TRI()).toString();

        const complexRewarder = (await MasterChef.rewarder(pid)).toString();

        if (complexRewarder != constants.ZERO_ADDRESS) {
            const ComplexRewarder = await IComplexRewarder.at(complexRewarder);
            const data = await ComplexRewarder.pendingTokens(pid, constants.ZERO_ADDRESS, 0);
            rewarderTokenAddress = data["0"]["0"].toString();
        } else {
            rewarderTokenAddress = constants.ZERO_ADDRESS;
        }

        lpToken = await IERC20.at(lpTokenAddress);
        stakingToken = await IERC20.at(lpTokenAddress);

        Swap = await ISwap.at(swapAddress);
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
                    assetRouter.deposit(swapAddress, [0, 0, 0], 0, 0, account1, { from: account1 }),
                    "Pausable: paused",
                );
                await expectRevert(
                    assetRouter.withdraw(swapAddress, 0, [0, 0, 0], false, account1, {
                        from: account1,
                    }),
                    "Pausable: paused",
                );
                await expectRevert(
                    assetRouter.distribute(
                        swapAddress,
                        [[constants.ZERO_ADDRESS], [constants.ZERO_ADDRESS]],
                        [[constants.ZERO_ADDRESS], [constants.ZERO_ADDRESS]],
                        [0, 0, 0, 0],
                        [0, 0, 0, 0],
                        { from: account1 },
                    ),
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
                    assetRouter.deposit(swapAddress, [0, 0, 0], 0, 0, account1, { from: account1 }),
                    "NO_LIQUIDITY_PROVIDED",
                );
                await expectRevert(
                    assetRouter.withdraw(swapAddress, 0, [0, 0, 0], false, account1, {
                        from: account1,
                    }),
                    "FARM_NOT_EXISTS",
                );
                await expectRevert(
                    assetRouter.distribute(
                        swapAddress,
                        [[constants.ZERO_ADDRESS], [constants.ZERO_ADDRESS]],
                        [[constants.ZERO_ADDRESS], [constants.ZERO_ADDRESS]],
                        [0, 0, 0, 0],
                        [0, 0, 0, 0],
                        { from: account1 },
                    ),
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
                    assetRouter.deposit(swapAddress, [0, 0, 0], 0, 0, account1, { from: account1 }),
                    "NO_LIQUIDITY_PROVIDED",
                );
            });
        });
        describe("deposit lp tokens in new pool", () => {
            let receipt;
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[0], { from: account1 });

                receipt = await assetRouter.deposit(
                    swapAddress,
                    [0, 0, 0],
                    0,
                    amounts[0],
                    account1,
                    {
                        from: account1,
                    },
                );

                const farmAddress = await factory.Farms(swapAddress);
                farm = await Farm.at(farmAddress);
            });
            it("fires events", async () => {
                expectEvent(receipt, "Deposit", {
                    lpPool: swapAddress,
                    sender: account1,
                    recipient: account1,
                    amount: amounts[0],
                });
            });
            it("updates stakes", async () => {
                const stakeLP = await assetRouter.userStake(account1, swapAddress);
                assert.equal(
                    stakeLP.toString(),
                    amounts[0].toString(),
                    "Amount sent doesn't equal userStake",
                );
            });
            it("updates totalDeposits", async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(swapAddress);
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
                receipt = await assetRouter.deposit(
                    swapAddress,
                    [0, 0, 0],
                    0,
                    amounts[1],
                    account1,
                    {
                        from: account1,
                    },
                );
            });
            it("fires events", async () => {
                expectEvent(receipt, "Deposit", {
                    lpPool: swapAddress,
                    sender: account1,
                    recipient: account1,
                    amount: amounts[1],
                });
            });
            it("updates stakes", async () => {
                const stakeLP = await assetRouter.userStake(account1, swapAddress);
                assert.equal(
                    stakeLP.toString(),
                    amounts[0].add(amounts[1]).toString(),
                    "Amount sent doesn't equal userStake",
                );
            });
            it("updates totalDeposits", async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(swapAddress);
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
                receipt = await assetRouter.deposit(
                    swapAddress,
                    [0, 0, 0],
                    0,
                    amounts[2],
                    account2,
                    {
                        from: account2,
                    },
                );
            });
            it("fires events", async () => {
                expectEvent(receipt, "Deposit", {
                    lpPool: swapAddress,
                    sender: account2,
                    recipient: account2,
                    amount: amounts[2],
                });
            });
            it("doesn't change stakes for account[0]", async () => {
                const stakeLP = await assetRouter.userStake(account1, swapAddress);
                assert.equal(
                    stakeLP.toString(),
                    amounts[0].add(amounts[1]).toString(),
                    "Amount sent changed userStake for account1",
                );
            });
            it("updates stakes for account[1]", async () => {
                const stakeLP = await assetRouter.userStake(account2, swapAddress);
                assert.equal(
                    stakeLP.toString(),
                    amounts[2].toString(),
                    "Amount sent doesn't equal userStake",
                );
            });
            it("updates totalDeposits", async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(swapAddress);
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
                receipt = await assetRouter.deposit(
                    swapAddress,
                    [0, 0, 0],
                    0,
                    amounts[3],
                    account2,
                    {
                        from: account1,
                    },
                );
            });
            it("fires event", async () => {
                expectEvent(receipt, "Deposit", {
                    lpPool: swapAddress,
                    sender: account1,
                    recipient: account2,
                    amount: amounts[3],
                });
            });
            it("doesnt change stakes for account1", async () => {
                const stakeLP = await assetRouter.userStake(account1, swapAddress);
                assert.equal(
                    stakeLP.toString(),
                    amounts[0].add(amounts[1]).toString(),
                    "stakeLP is not 0",
                );
            });
            it("updates stakes for account2", async () => {
                const stakeLP = await assetRouter.userStake(account2, swapAddress);
                assert.equal(
                    stakeLP.toString(),
                    amounts[2].add(amounts[3]).toString(),
                    "Amount sent doesn't equal userStake",
                );
            });
            it("updates totalDeposits", async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(swapAddress);
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
            let amountsWithdrawn = [];
            let balancesBefore = [];

            let stakesBefore;

            let receipt;

            before(async () => {
                for (let i = 0; i < poolTokensAddresses.length; i++) {
                    const token = await IERC20.at((await Swap.getToken(i)).toString());
                    balancesBefore.push(
                        new BN((await token.balanceOf(accountNormalTokens)).toString()),
                    );
                    await token.approve(assetRouter.address, balancesBefore[i], {
                        from: accountNormalTokens,
                    });
                }
            });

            it("fires events", async () => {
                receipt = await assetRouter.deposit(
                    swapAddress,
                    [amounts[1], amounts[2], amounts[3]],
                    0,
                    0,
                    accountNormalTokens,
                    {
                        from: accountNormalTokens,
                    },
                );
                expectEvent(receipt, "Deposit", {
                    lpPool: swapAddress,
                    sender: accountNormalTokens,
                    recipient: accountNormalTokens,
                });
            });
            it("withdraws tokens from balance", async () => {
                let balancesAfter = [];
                for (let i = 0; i < poolTokensAddresses.length; i++) {
                    const token = await IERC20.at((await Swap.getToken(i)).toString());
                    balancesAfter.push(
                        new BN((await token.balanceOf(accountNormalTokens)).toString()),
                    );
                }
                for (let i = 0; i < poolTokensAddresses.length; i++) {
                    approxeq(
                        balancesBefore[i].sub(balancesAfter[i]),
                        amounts[i + 1],
                        new BN(1),
                        "Stakes are not correct",
                    );
                }
            });
            it("updates stakes", async () => {
                const stakeLP = new BN(
                    (await assetRouter.userStake(accountNormalTokens, swapAddress)).toString(),
                );
                const amount = new BN(
                    (
                        await Swap.calculateTokenAmount([amounts[1], amounts[2], amounts[3]], true)
                    ).toString(),
                );

                approxeq(
                    stakeLP,
                    amount,
                    stakeLP.div(new BN(1000)),
                    "Approximate amount LP tokens received doesn't equal userStake",
                );
            });
            it("updates totalDeposits", async () => {
                const totalDepositsLP = new BN(
                    (await assetRouter.totalDeposits(swapAddress)).toString(),
                );
                const amount = new BN(
                    (
                        await Swap.calculateTokenAmount([amounts[1], amounts[2], amounts[3]], true)
                    ).toString(),
                );
                approxeq(
                    totalDepositsLP,
                    amount,
                    totalDepositsLP.div(new BN(1000)),
                    "Total amount sent doesn't equal totalDeposits",
                );
            });
            it("stakes tokens in MasterChef contract", async () => {
                const tokensStaked = new BN(
                    (await MasterChef.userInfo(pid, farm.address))["0"].toString(),
                );
                const approximatetokensReceived = new BN(
                    (
                        await Swap.calculateTokenAmount([amounts[1], amounts[2], amounts[3]], true)
                    ).toString(),
                );

                approxeq(
                    tokensStaked,
                    approximatetokensReceived,
                    tokensStaked.div(new BN(1000)),
                    "Total amount staked doesn't equal approximate amount of tokens received from Swap",
                );
            });
        });
    });
    describe("withdraw", () => {
        describe("reverts", () => {
            it("reverts if the pool doesnt exist", async () => {
                await expectRevert(
                    assetRouter.withdraw(swap2Address, 0, [0, 0, 0], true, account1, {
                        from: account1,
                    }),
                    "FARM_NOT_EXISTS",
                );
            });
            it("reverts if the stake is zero", async () => {
                await expectRevert.unspecified(
                    assetRouter.withdraw(
                        swapAddress,
                        constants.MAX_UINT256,
                        [0, 0, 0],
                        true,
                        account1,
                        {
                            from: account1,
                        },
                    ),
                );
            });
            it("reverts if amount provided is 0", async () => {
                await expectRevert(
                    assetRouter.withdraw(swapAddress, 0, [0, 0, 0], true, account1, {
                        from: account1,
                    }),
                    "INSUFFICIENT_AMOUNT",
                );
            });
        });
        describe("withdraws for multiple accs", () => {
            let balances1before = [];
            let balances2before = [];

            let balance1before, balance2before;

            let stake1before;
            let stake2before;

            let receipt1, receipt2;

            let totalDepositsBefore;

            before(async () => {
                for (let i = 0; i < poolTokensAddresses.length; i++) {
                    const token = await IERC20.at((await Swap.getToken(i)).toString());
                    balances1before.push(
                        new BN((await token.balanceOf(accountNormalTokens)).toString()),
                    );
                    balances2before.push(
                        new BN((await token.balanceOf(accountNormalTokens)).toString()),
                    );
                }

                balance1before = await stakingToken.balanceOf(account1);
                balance2before = await stakingToken.balanceOf(account2);

                totalDepositsBefore = await assetRouter.totalDeposits(swapAddress);

                stake1before = await assetRouter.userStake(account1, swapAddress);
                stake2before = await assetRouter.userStake(account2, swapAddress);

                receipt1 = await assetRouter.withdraw(
                    swapAddress,
                    amounts[0],
                    [0, 0, 0],
                    true,
                    account1,
                    {
                        from: account1,
                    },
                );
                receipt2 = await assetRouter.withdraw(
                    swapAddress,
                    amounts[2],
                    [0, 0, 0],
                    true,
                    account2,
                    {
                        from: account2,
                    },
                );
            });
            it("fires events", async () => {
                expectEvent(receipt1, "Withdraw", {
                    lpPool: swapAddress,
                    sender: account1,
                    recipient: account1,
                    amount: amounts[0],
                });
                expectEvent(receipt2, "Withdraw", {
                    lpPool: swapAddress,
                    sender: account2,
                    recipient: account2,
                    amount: amounts[2],
                });
            });

            it("correctly updates userStake for account1", async () => {
                const stakeLP = await assetRouter.userStake(account1, swapAddress);
                assert.equal(
                    stakeLP.toString(),
                    stake1before.sub(amounts[0]).toString(),
                    "Stake is not zero for account1",
                );
            });
            it("correctly updates userStake for account2", async () => {
                const stakeLP = await assetRouter.userStake(account2, swapAddress);
                assert.equal(
                    stakeLP.toString(),
                    stake2before.sub(amounts[2]).toString(),
                    "Stake is not right for account2",
                );
            });
            it("correctly updates totalDeposits", async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(swapAddress);

                assert.equal(
                    totalDepositsBefore.sub(totalDepositsLP).toString(),
                    amounts[0].add(amounts[2]).toString(),
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

                stake1before = await assetRouter.userStake(account1, swapAddress);
                stake2before = await assetRouter.userStake(account2, swapAddress);

                receipt = await assetRouter.withdraw(
                    swapAddress,
                    amounts[1],
                    [0, 0, 0],
                    true,
                    account2,
                    {
                        from: account1,
                    },
                );
            });
            it("fires events", async () => {
                expectEvent(receipt, "Withdraw", {
                    lpPool: swapAddress,
                    sender: account1,
                    recipient: account2,
                    amount: amounts[1],
                });
            });
            it("correctly changes userStake for account1", async () => {
                const stakeLP = await assetRouter.userStake(account1, swapAddress);
                assert.equal(
                    stakeLP.toString(),
                    stake1before.sub(amounts[1]).toString(),
                    "Stake is not right for account1",
                );
            });
            it("doesnt change stake for account2", async () => {
                const stakeLP = await assetRouter.userStake(account2, swapAddress);
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
            let stakeLP1;
            let stakeLP2;

            let receipt;

            let balancesBefore = [];
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[1], { from: account1 });
                await stakingToken.approve(assetRouter.address, amounts[3], { from: account2 });

                await assetRouter.deposit(swapAddress, [0, 0, 0], 0, amounts[1], account1, {
                    from: account1,
                });
                await assetRouter.deposit(swapAddress, [0, 0, 0], 0, amounts[3], account2, {
                    from: account2,
                });

                for (let i = 0; i < poolTokensAddresses.length; i++) {
                    const token = await IERC20.at((await Swap.getToken(i)).toString());
                    balancesBefore.push(await token.balanceOf(account1));
                }

                stakeLP1 = await assetRouter.userStake(account1, swapAddress);
                stakeLP2 = await assetRouter.userStake(account2, swapAddress);

                receipt = await assetRouter.withdraw(
                    swapAddress,
                    stakeLP1,
                    [0, 0, 0],
                    false,
                    account1,
                    {
                        from: account1,
                    },
                );
            });
            it("fires events", async () => {
                expectEvent(receipt, "Withdraw", {
                    lpPool: swapAddress,
                    sender: account1,
                    recipient: account1,
                    amount: stakeLP1,
                });
            });
            it("correctly updates account1 stake", async () => {
                const stakeLP = await assetRouter.userStake(account1, swapAddress);
                assert.equal(stakeLP.toString(), "0", "stakeLP is wrong");
            });
            it("doesnt update account2 stake", async () => {
                const stakeLP = await assetRouter.userStake(account2, swapAddress);
                assert.equal(stakeLP.toString(), stakeLP2, "stakeLP is wrong");
            });
            it("transfers tokens to user", async () => {
                let withdrawn = false;
                for (let i = 0; i < poolTokensAddresses.length; i++) {
                    const token = await IERC20.at((await Swap.getToken(i)).toString());
                    balanceAfter = await token.balanceOf(account1);

                    if (balanceAfter > balancesBefore[i]) {
                        withdrawn = true;
                    }
                    assert.isTrue(balanceAfter >= balancesBefore[i], "Tokens were not withdrawn");
                }

                assert.isTrue(withdrawn, "Tokens were not withdrawn");
            });
        });
        describe("withdraws normal tokens for a different user", () => {
            let balanceAbefore, balanceBbefore;

            let stakeLP2;
            let stakeLP1;

            let receipt;

            let balancesBefore = [];
            before(async () => {
                await stakingToken.approve(assetRouter.address, amounts[1], { from: account1 });
                await stakingToken.approve(assetRouter.address, amounts[3], { from: account2 });

                await assetRouter.deposit(swapAddress, [0, 0, 0], 0, amounts[1], account1, {
                    from: account1,
                });
                await assetRouter.deposit(swapAddress, [0, 0, 0], 0, amounts[3], account2, {
                    from: account2,
                });

                for (let i = 0; i < poolTokensAddresses.length; i++) {
                    const token = await IERC20.at((await Swap.getToken(i)).toString());
                    balancesBefore.push(await token.balanceOf(account1));
                }

                stakeLP1 = await assetRouter.userStake(account1, swapAddress);
                stakeLP2 = await assetRouter.userStake(account2, swapAddress);

                receipt = await assetRouter.withdraw(
                    swapAddress,
                    stakeLP2,
                    [0, 0, 0],
                    false,
                    account1,
                    {
                        from: account2,
                    },
                );
            });
            it("fires events", async () => {
                expectEvent(receipt, "Withdraw", {
                    lpPool: swapAddress,
                    sender: account2,
                    recipient: account1,
                    amount: stakeLP2,
                });
            });
            it("correctly updates account2 stake", async () => {
                const stakeLP = await assetRouter.userStake(account2, swapAddress);
                assert.equal(stakeLP.toString(), "0", "stakeLP is wrong");
            });
            it("doesnt update account1 stake", async () => {
                const stakeLP = await assetRouter.userStake(account1, swapAddress);
                assert.equal(stakeLP.toString(), stakeLP1, "stakeLP is wrong");
            });
            it("transfers tokens to correct user", async () => {
                let withdrawn = false;
                for (let i = 0; i < poolTokensAddresses.length; i++) {
                    const token = await IERC20.at((await Swap.getToken(i)).toString());
                    const balanceAfter = await token.balanceOf(account1);

                    if (balanceAfter.toNumber() > balancesBefore[i].toNumber()) {
                        withdrawn = true;
                    }
                    assert.isAtLeast(
                        balanceAfter.toNumber(),
                        balancesBefore[i].toNumber(),
                        "Tokens were not withdrawn",
                    );
                }

                assert.isTrue(withdrawn, "Tokens were not withdrawn");
            });
        });
    });
    describe("Distributions", () => {
        describe("reverts", () => {
            it("reverts if called not by distributor", async () => {
                await expectRevert(
                    assetRouter.distribute(
                        swapAddress,
                        [
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            ],
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [0, 0, 0, 0],
                        [0, 0, 0, 0],
                        { from: pauser },
                    ),
                    "CALLER_NOT_DISTRIBUTOR",
                );
            });
            it("reverts if pool doesnt exist", async () => {
                await expectRevert(
                    assetRouter.distribute(
                        swap2Address,
                        [
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            ],
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [0, 0, 0, 0],
                        [0, 0, 0, 0],
                        {
                            from: distributor,
                        },
                    ),
                    "FARM_NOT_EXISTS",
                );
            });
        });
        describe("distributes", () => {
            let receipt;
            let balance1, balance2;
            before(async () => {
                balance1 = await stakingToken.balanceOf(account1);
                await stakingToken.approve(assetRouter.address, balance1, { from: account1 });
                await assetRouter.deposit(swapAddress, [0, 0, 0], 0, balance1, account1, {
                    from: account1,
                });

                balance2 = await stakingToken.balanceOf(account2);
                await stakingToken.approve(assetRouter.address, balance2, { from: account2 });
                await assetRouter.deposit(swapAddress, [0, 0, 0], 0, balance2, account2, {
                    from: account2,
                });

                await timeMachine.advanceTimeAndBlock(10000);

                const farmAddress = await factory.Farms(swapAddress);
                farm = await Farm.at(farmAddress);

                const AURORA = await IERC20.at("0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79");
                const AURORA_BALANCE = await AURORA.balanceOf(farm.address);

                const TRI = await IERC20.at("0xFa94348467f64D5A457F75F8bc40495D33c65aBB");

                const balancenormalTRI = await TRI.balanceOf(accountNormalTokens);
                await TRI.transfer(farm.address, balancenormalTRI, {
                    from: accountNormalTokens,
                });

                const TRI_BALANCE = await TRI.balanceOf(farm.address);

                receipt = await assetRouter.distribute(
                    swapAddress,
                    [
                        [
                            "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                            "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                        ],
                        [
                            "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                            "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                            "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                        ],
                        [
                            "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                            "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                            "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                        ],
                    ],
                    [
                        [
                            "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                            "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                            "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                            "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                        ],
                        [
                            "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                            "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                            "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                            "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                        ],
                        [
                            "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                            "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                            "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                        ],
                    ],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0],
                    { from: distributor },
                );
            });
            it("emits event", async () => {
                expectEvent(receipt, "Distribute", { lpPool: swapAddress });
            });
            it("increases token stakes", async () => {
                const stake1 = await assetRouter.userStake(account1, swapAddress);

                assert.isTrue(stake1 > balance1, "Stake1 not increased");

                const stake2 = await assetRouter.userStake(account2, swapAddress);

                assert.isTrue(stake2 > balance2, "Stake2 not increased");
            });
        });
        describe("bad path reverts", () => {
            it("reverts if passed wrong reward tokens", async () => {
                await expectRevert(
                    assetRouter.distribute(
                        swapAddress,
                        [
                            [
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            ],
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [0, 0, 0, 0],
                        [0, 0, 0, 0],
                        { from: distributor },
                    ),
                    "BAD_REWARD_TOKEN_ROUTES",
                ); // token1
                await expectRevert(
                    assetRouter.distribute(
                        swapAddress,
                        [
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            ],
                            [
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [0, 0, 0, 0],
                        [0, 0, 0, 0],
                        { from: distributor },
                    ),
                    "BAD_REWARD_TOKEN_ROUTES",
                ); // token 2
                await expectRevert(
                    assetRouter.distribute(
                        swapAddress,
                        [
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            ],
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [0, 0, 0, 0],
                        [0, 0, 0, 0],
                        { from: distributor },
                    ),
                    "BAD_REWARD_TOKEN_ROUTES",
                ); // token 3
            });
            it("reverts if passed wrong token1", async () => {
                await expectRevert(
                    assetRouter.distribute(
                        swapAddress,
                        [
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",//
                            ],
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [0, 0, 0, 0],
                        [0, 0, 0, 0],
                        { from: distributor },
                    ),
                    "BAD_REWARD_TOKEN_ROUTES",
                );
            });
            it("reverts if passed wrong token2", async () => {
                await expectRevert(
                    assetRouter.distribute(
                        swapAddress,
                        [
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            ],
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [0, 0, 0, 0],
                        [0, 0, 0, 0],
                        { from: distributor },
                    ),
                    "BAD_REWARDER_TOKEN_ROUTES",
                );
            });
            it("reverts if passed wrong token3", async () => {
                await expectRevert(
                    assetRouter.distribute(
                        swapAddress,
                        [
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            ],
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                            ],
                        ],
                        [
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [0, 0, 0, 0],
                        [0, 0, 0, 0],
                        { from: distributor },
                    ),
                    "BAD_REWARD_TOKEN_ROUTES",
                );
            });
        });
        describe("withdraws", () => {
            it("withdraws all tokens for account1", async () => {
                let stakeLP = await assetRouter.userStake(account1, swapAddress);

                await assetRouter.withdraw(swapAddress, stakeLP, [0, 0, 0], true, account1, {
                    from: account1,
                });

                stakeLP = await assetRouter.userStake(account1, swapAddress);
                assert.equal(stakeLP.toString(), "0", "acount1 stake not 0");
            });
            it("withdraws tokens for account2", async () => {
                let stakeLP = await assetRouter.userStake(account2, swapAddress);

                await assetRouter.withdraw(swapAddress, stakeLP, [0, 0, 0], true, account2, {
                    from: account2,
                });

                stakeLP = await assetRouter.userStake(account2, swapAddress);
                assert.equal(stakeLP.toString(), "0", "acount2 stake not 0");
            });
            it("withdraws tokens for accountNormalTokens", async () => {
                let stakeLP = await assetRouter.userStake(accountNormalTokens, swapAddress);

                if (stakeLP > 0) {
                    await assetRouter.withdraw(
                        swapAddress,
                        stakeLP,
                        [0, 0, 0],
                        true,
                        accountNormalTokens,
                        {
                            from: accountNormalTokens,
                        },
                    );
                }

                stakeLP = await assetRouter.userStake(accountNormalTokens, swapAddress);
                assert.equal(stakeLP.toString(), "0", "accountNormalTokens stake not 0");
            });
            it("not leaves any tokens", async () => {
                const totalDepositsLP = await assetRouter.totalDeposits(swapAddress);
                assert.equal(totalDepositsLP.toString(), "0", "totalDeposits not 0");
            });
            it("reverts if there is no liquidity in the pool", async () => {
                await expectRevert(
                    assetRouter.distribute(
                        swapAddress,
                        [
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            ],
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0xFa94348467f64D5A457F75F8bc40495D33c65aBB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
                                "0x4988a896b1227218e4A686fdE5EabdcAbd91571f",
                            ],
                            [
                                "0x8BEc47865aDe3B172A928df8f990Bc7f2A3b9f79",
                                "0xC42C30aC6Cc15faC9bD938618BcaA1a1FaE8501d",
                                "0x5183e1B1091804BC2602586919E6880ac1cf2896",
                            ],
                        ],
                        [0, 0, 0, 0],
                        [0, 0, 0, 0],
                        {
                            from: distributor,
                        },
                    ),
                    "NO_LIQUIDITY",
                );
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
