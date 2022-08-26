const { expectRevert, expectEvent, BN, constants, time } = require("@openzeppelin/test-helpers");

const timeMachine = require("ganache-time-traveler");

const IERC20 = artifacts.require("IERC20");

const AccessManager = artifacts.require("UnoAccessManager");

const AutoStrategy = artifacts.require("UnoAutoStrategy");
const AutoStrategyV2 = artifacts.require("UnoAutoStrategyV2");
const AutoStrategyFactory = artifacts.require("UnoAutoStrategyFactory");

const pool1 = "0xafb76771c98351aa7fca13b130c9972181612b54"; // usdt-usdc quickswap
const pool2 = "0x4b1f1e2435a9c96f7330faea190ef6a7c8d70001"; // usdt-usdc sushiswap

const assetRouter1 = "0xF5AE5c5151aE25019be8b328603C18153d669461"; // quickswap
const assetRouter2 = "0xa5eb4E95a92b74f48f8eb118c4675095DcCDe3f8"; // sushiswap

const account1 = "0x477b8D5eF7C2C42DB84deB555419cd817c336b6F"; // -u

const amounts = [new BN(1000), new BN(3000), new BN(500), new BN(4000), new BN(4400000000), new BN(5000)];

approxeq = function (bn1, bn2, epsilon, message) {
    const amountDelta = bn1.sub(bn2).add(epsilon);
    assert.ok(!amountDelta.isNeg(), message);
};

contract("UnoAutoStrategyFactory", (accounts) => {
    const admin = accounts[0];
    const pauser = accounts[1];
    const liquidityManager = accounts[2];

    let accessManager;

    let autoStrategyFactory;
    let autoStrategy;

    let strategyToken;
    let snapshotId;
    let snapshotIdBeforeDeposit;
    before(async () => {
        accessManager = await AccessManager.new({ from: admin }); //accounts[0] is admin

        await accessManager.grantRole(
            "0x77e60b99a50d27fb027f6912a507d956105b4148adab27a86d235c8bcca8fa2f",
            liquidityManager,
            { from: admin }
        ); //DISTRIBUTOR_ROLE
        await accessManager.grantRole("0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a", pauser, {
            from: admin,
        }); //PAUSER_ROLE

        const autoStrategyImplementation = await AutoStrategy.new();

        autoStrategyFactory = await AutoStrategyFactory.new(autoStrategyImplementation.address, accessManager.address);
    });
    describe("Init Values", () => {
        describe("inits values", () => {
            it("inits access manager", async () => {
                const factoryAccessManager = await autoStrategyFactory.accessManager();

                assert.equal(
                    factoryAccessManager,
                    accessManager.address,
                    `Access Manager is not set correctly`
                );
            });
        });
    });
    describe("Modifiers", () => {
        describe("onlyAdmin revokes", () => {
            it("cannot approveAssetRouter if not administrator", async () => {
                await expectRevert(
                    autoStrategyFactory.approveAssetRouter(assetRouter1, {
                        from: pauser,
                    }),
                    "CALLER_NOT_AUTHORIZED"
                );
            });
            it("cannot revokeAssetRouter if not administrator", async () => {
                await expectRevert(
                    autoStrategyFactory.revokeAssetRouter(assetRouter1, {
                        from: pauser,
                    }),
                    "CALLER_NOT_AUTHORIZED"
                );
            });
            it("cannot upgradeStrategies if not administrator", async () => {
                await expectRevert(
                    autoStrategyFactory.upgradeStrategies(constants.ZERO_ADDRESS, {
                        from: pauser,
                    }),
                    "CALLER_NOT_AUTHORIZED"
                );
            });
        });
        describe("onlyPauser revokes", () => {
            it("cannot pause if not pauser", async () => {
                await expectRevert(
                    autoStrategyFactory.pause({
                        from: admin,
                    }),
                    "CALLER_NOT_AUTHORIZED"
                );
            });
            it("cannot unpause if not pauser", async () => {
                await expectRevert(
                    autoStrategyFactory.unpause({
                        from: admin,
                    }),
                    "CALLER_NOT_AUTHORIZED"
                );
            });
        });
        describe("whenNotPaused revokes", () => {
            before(async () => {
                await autoStrategyFactory.pause({ from: pauser });
            });
            after(async () => {
                await autoStrategyFactory.unpause({ from: pauser });
            });
            //passes pausable checks but fails on role check
            it("can approveAssetRouter when paused", async () => {
                await expectRevert(
                    autoStrategyFactory.approveAssetRouter(assetRouter1, {
                        from: pauser,
                    }),
                    "CALLER_NOT_AUTHORIZED"
                );
            });
            it("can revokeAssetRouter when paused", async () => {
                await expectRevert(
                    autoStrategyFactory.revokeAssetRouter(assetRouter1, {
                        from: pauser,
                    }),
                    "CALLER_NOT_AUTHORIZED"
                );
            });
            it("can upgradeStrategies when paused", async () => {
                await expectRevert(
                    autoStrategyFactory.upgradeStrategies(constants.ZERO_ADDRESS, {
                        from: pauser,
                    }),
                    "CALLER_NOT_AUTHORIZED"
                );
            });
            it("cant createStrategy when paused", async () => {
                await expectRevert(
                    autoStrategyFactory.createStrategy([]),
                    "Pausable: paused"
                );
            })
        });
    });
    describe("Asset Router Approvals", () => {
        describe("revokes", () => {
            it("cannot approve twice", async () => {
                await autoStrategyFactory.approveAssetRouter(assetRouter1, {
                    from: admin,
                });

                await expectRevert(
                    autoStrategyFactory.approveAssetRouter(assetRouter1, {
                        from: admin,
                    }),
                    "ASSET_ROUTER_ALREADY_APPROVED"
                );
            });
            it("cannot revoke if was not approved", async () => {
                await autoStrategyFactory.revokeAssetRouter(assetRouter1, {
                    from: admin,
                });
                await expectRevert(
                    autoStrategyFactory.revokeAssetRouter(assetRouter1, {
                        from: admin,
                    }),
                    "ASSET_ROUTER_NOT_APPROVED"
                );
            });
        });
        describe("approves", () => {
            let receipt;
            before(async () => {
                receipt = await autoStrategyFactory.approveAssetRouter(assetRouter1, {
                    from: admin,
                });
            });
            after(async () => {
                await autoStrategyFactory.revokeAssetRouter(assetRouter1, {
                    from: admin,
                });
            });
            it("assetRouterApproved", async () => {
                assert.ok(
                    await autoStrategyFactory.assetRouterApproved(assetRouter1),
                    `${assetRouter1} was not approved`
                );
            });
            it("fires event", async () => {
                expectEvent(receipt, "AssetRouterApproved", {
                    assetRouter: assetRouter1,
                });
            });
        });
        describe("revokes", () => {
            let receipt;
            before(async () => {
                await autoStrategyFactory.approveAssetRouter(assetRouter1, {
                    from: admin,
                });
                receipt = await autoStrategyFactory.revokeAssetRouter(assetRouter1, {
                    from: admin,
                });
            });
            it("assetRouterApproved", async () => {
                assert.ok(
                    !(await autoStrategyFactory.assetRouterApproved(assetRouter1)),
                    `${assetRouter1} was not approved`
                );
            });
            it("fires event", async () => {
                expectEvent(receipt, "AssetRouterRevoked", {
                    assetRouter: assetRouter1,
                });
            });
        });
    });
    describe("Strategies", () => {
        describe("revokes", () => {
            before(async () => {
                await autoStrategyFactory.approveAssetRouter(assetRouter1, {
                    from: admin,
                });
            });
            after(async () => {
                await autoStrategyFactory.revokeAssetRouter(assetRouter1, {
                    from: admin,
                });
            });
            it("cannot create strategy if one of the assetRouters is not approved", async () => {
                await expectRevert(
                    autoStrategyFactory.createStrategy(
                        [
                            { pool: pool1, assetRouter: assetRouter1 },
                            { pool: pool2, assetRouter: assetRouter2 },
                        ],
                        {
                            from: admin,
                        }
                    ),
                    "ASSET_ROUTER_NOT_APPROVED"
                );
            });
        });
        describe("createStrategy", () => {
            let receipt;
            before(async () => {
                await autoStrategyFactory.approveAssetRouter(assetRouter1, {
                    from: admin,
                });
                await autoStrategyFactory.approveAssetRouter(assetRouter2, {
                    from: admin,
                });
            });
            after(async () => {
                await autoStrategyFactory.revokeAssetRouter(assetRouter1, {
                    from: admin,
                });
                await autoStrategyFactory.revokeAssetRouter(assetRouter2, {
                    from: admin,
                });
            });
            it("can createStrategy", async () => {
                receipt = await autoStrategyFactory.createStrategy(
                    [
                        { pool: pool1, assetRouter: assetRouter1 },
                        { pool: pool2, assetRouter: assetRouter2 },
                    ],
                    {
                        from: admin,
                    }
                );
            });
            it("fires event", async () => {
                const autoStrategyAddress = await autoStrategyFactory.autoStrategies(0);

                expectEvent(receipt, "AutoStrategyDeployed", {
                    autoStrategy: autoStrategyAddress,
                });
            });
            it("can deposit into the strategy", async () => {
                const autoStrategyAddress = await autoStrategyFactory.autoStrategies(0);

                const autoStrategy = await AutoStrategy.at(autoStrategyAddress);

                const id = await autoStrategy.poolID();

                const data = await autoStrategy.pools(id);

                const tokenA = await IERC20.at(data["tokenA"]);
                const tokenB = await IERC20.at(data["tokenB"]);

                await tokenA.approve(autoStrategy.address, amounts[1], {
                    from: account1,
                });
                await tokenB.approve(autoStrategy.address, amounts[1], {
                    from: account1,
                });

                await autoStrategy.deposit(id, amounts[1], amounts[1], 0, 0, account1, { from: account1 });
            });
            it("updates autoStrategiesLength", async () => {
                const autoStrategiesLength = await autoStrategyFactory.autoStrategiesLength();

                assert.equal(autoStrategiesLength.toString(), "1", `autoStrategiesLength is not set correctly`);
            });
        });
    });
    describe("Upgrades", () => {
        let implementationV2;
        before(async () => {
            implementationV2 = await AutoStrategyV2.new();
        });
        it("upgrades", async () => {
            const receipt = await autoStrategyFactory.upgradeStrategies(implementationV2.address, { from: admin });

            let event = receipt.receipt.rawLogs.some((l) => {
                const topic1 = l.topics[0] == web3.utils.keccak256("Upgraded(address)").toLowerCase();
                const topic2 = l.topics[1] == web3.utils.padLeft(implementationV2.address, 64).toLowerCase();
                return topic1 && topic2;
            });

            assert.ok(event, `Upgraded${implementationV2.address} event not emitted`);

            const autoStrategyAddress = await autoStrategyFactory.autoStrategies(0);

            const autoStrategy = await AutoStrategyV2.at(autoStrategyAddress);

            assert.equal(await autoStrategy.accessManager(), accessManager.address, "accessManager changed");
            assert.equal(await autoStrategy.factory(), autoStrategyFactory.address, "factory changed");
            assert.equal(await autoStrategy.version(), 2, "Strategy not upgraded");
        });
    });
});
