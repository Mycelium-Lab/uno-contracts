const {
    expectRevert, expectEvent, BN, constants
} = require('@openzeppelin/test-helpers')
const { deployProxy } = require('@openzeppelin/truffle-upgrades')

const UnoAssetRouterVelodrome = artifacts.require('UnoAssetRouterVelodrome')
const UnoFarmVelodrome = artifacts.require('UnoFarmVelodrome')
const FarmFactory = artifacts.require('UnoFarmFactory')

const IERC20 = artifacts.require('IERC20')

const AccessManager = artifacts.require('UnoAccessManager')

const AutoStrategy = artifacts.require('UnoAutoStrategy')
const AutoStrategyV2 = artifacts.require('UnoAutoStrategyV2')
const AutoStrategyFactory = artifacts.require('UnoAutoStrategyFactory')

const pool1 = '0x0F30716960F0618983Ac42bE2982FfEC181AF265' // velo-optimism
const pool2 = '0xbc8e6e4ea64e1b1da50b8ffc27f7395034e978ab' // velo-optimism

const account1 = '0xd43f3716CbB9386352880a9BD52f7F07aC01752B' // has to be unlocked and hold velo-optimism

const amounts = [new BN(1000), new BN(30000), new BN(500), new BN(4000), new BN(4400000000), new BN(5000)]

contract('UnoAutoStrategyFactory', (accounts) => {
    const admin = accounts[0]
    const pauser = accounts[1]
    const liquidityManager = accounts[2]

    let accessManager

    let autoStrategyFactory
    let assetRouterVelodrome
    let assetRouterVelodrome2
    before(async () => {
        accessManager = await AccessManager.new({ from: admin }) // accounts[0] is admin

        await accessManager.grantRole(
            '0x77e60b99a50d27fb027f6912a507d956105b4148adab27a86d235c8bcca8fa2f',
            liquidityManager,
            { from: admin }
        ) // DISTRIBUTOR_ROLE
        await accessManager.grantRole('0x65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a', pauser, {
            from: admin
        }) // PAUSER_ROLE

        assetRouterVelodrome = await deployProxy(
            UnoAssetRouterVelodrome,
            { kind: 'uups', initializer: false }
        )
        const farmImplementationVelodrome = await UnoFarmVelodrome.new()
        await FarmFactory.new(farmImplementationVelodrome.address, accessManager.address, assetRouterVelodrome.address)

        assetRouterVelodrome2 = await deployProxy(
            UnoAssetRouterVelodrome,
            { kind: 'uups', initializer: false }
        )
        await FarmFactory.new(farmImplementationVelodrome.address, accessManager.address, assetRouterVelodrome2.address)

        const autoStrategyImplementation = await AutoStrategy.new()
        autoStrategyFactory = await AutoStrategyFactory.new(autoStrategyImplementation.address, accessManager.address)
    })
    describe('Init Values', () => {
        describe('inits values', () => {
            it('inits access manager', async () => {
                const factoryAccessManager = await autoStrategyFactory.accessManager()

                assert.equal(
                    factoryAccessManager,
                    accessManager.address,
                    'Access Manager is not set correctly'
                )
            })
        })
    })
    describe('Modifiers', () => {
        describe('onlyAdmin revokes', () => {
            it('cannot approveAssetRouter if not administrator', async () => {
                await expectRevert(
                    autoStrategyFactory.approveAssetRouter(assetRouterVelodrome.address, {
                        from: pauser
                    }),
                    'CALLER_NOT_AUTHORIZED'
                )
            })
            it('cannot revokeAssetRouter if not administrator', async () => {
                await expectRevert(
                    autoStrategyFactory.revokeAssetRouter(assetRouterVelodrome.address, {
                        from: pauser
                    }),
                    'CALLER_NOT_AUTHORIZED'
                )
            })
            it('cannot upgradeStrategies if not administrator', async () => {
                await expectRevert(
                    autoStrategyFactory.upgradeStrategies(constants.ZERO_ADDRESS, {
                        from: pauser
                    }),
                    'CALLER_NOT_AUTHORIZED'
                )
            })
        })
        describe('onlyPauser revokes', () => {
            it('cannot pause if not pauser', async () => {
                await expectRevert(
                    autoStrategyFactory.pause({
                        from: admin
                    }),
                    'CALLER_NOT_AUTHORIZED'
                )
            })
            it('cannot unpause if not pauser', async () => {
                await expectRevert(
                    autoStrategyFactory.unpause({
                        from: admin
                    }),
                    'CALLER_NOT_AUTHORIZED'
                )
            })
        })
        describe('whenNotPaused revokes', () => {
            before(async () => {
                await autoStrategyFactory.pause({ from: pauser })
            })
            after(async () => {
                await autoStrategyFactory.unpause({ from: pauser })
            })
            // passes pausable checks but fails on role check
            it('can approveAssetRouter when paused', async () => {
                await expectRevert(
                    autoStrategyFactory.approveAssetRouter(assetRouterVelodrome.address, {
                        from: pauser
                    }),
                    'CALLER_NOT_AUTHORIZED'
                )
            })
            it('can revokeAssetRouter when paused', async () => {
                await expectRevert(
                    autoStrategyFactory.revokeAssetRouter(assetRouterVelodrome.address, {
                        from: pauser
                    }),
                    'CALLER_NOT_AUTHORIZED'
                )
            })
            it('can upgradeStrategies when paused', async () => {
                await expectRevert(
                    autoStrategyFactory.upgradeStrategies(constants.ZERO_ADDRESS, {
                        from: pauser
                    }),
                    'CALLER_NOT_AUTHORIZED'
                )
            })
            it('cant createStrategy when paused', async () => {
                await expectRevert(
                    autoStrategyFactory.createStrategy([]),
                    'Pausable: paused'
                )
            })
        })
    })
    describe('Asset Router Approvals', () => {
        describe('revokes', () => {
            it('cannot approve twice', async () => {
                await autoStrategyFactory.approveAssetRouter(assetRouterVelodrome.address, {
                    from: admin
                })

                await expectRevert(
                    autoStrategyFactory.approveAssetRouter(assetRouterVelodrome.address, {
                        from: admin
                    }),
                    'ASSET_ROUTER_ALREADY_APPROVED'
                )
            })
            it('cannot revoke if was not approved', async () => {
                await autoStrategyFactory.revokeAssetRouter(assetRouterVelodrome.address, {
                    from: admin
                })
                await expectRevert(
                    autoStrategyFactory.revokeAssetRouter(assetRouterVelodrome.address, {
                        from: admin
                    }),
                    'ASSET_ROUTER_NOT_APPROVED'
                )
            })
        })
        describe('approves', () => {
            let receipt
            before(async () => {
                receipt = await autoStrategyFactory.approveAssetRouter(assetRouterVelodrome.address, {
                    from: admin
                })
            })
            after(async () => {
                await autoStrategyFactory.revokeAssetRouter(assetRouterVelodrome.address, {
                    from: admin
                })
            })
            it('assetRouterApproved', async () => {
                assert.ok(
                    await autoStrategyFactory.assetRouterApproved(assetRouterVelodrome.address),
                    `${assetRouterVelodrome.address} was not approved`
                )
            })
            it('fires event', async () => {
                expectEvent(receipt, 'AssetRouterApproved', {
                    assetRouter: assetRouterVelodrome.address
                })
            })
        })
        describe('revokes', () => {
            let receipt
            before(async () => {
                await autoStrategyFactory.approveAssetRouter(assetRouterVelodrome.address, {
                    from: admin
                })
                receipt = await autoStrategyFactory.revokeAssetRouter(assetRouterVelodrome.address, {
                    from: admin
                })
            })
            it('assetRouterApproved', async () => {
                assert.ok(
                    !(await autoStrategyFactory.assetRouterApproved(assetRouterVelodrome.address)),
                    `${assetRouterVelodrome.address} was not approved`
                )
            })
            it('fires event', async () => {
                expectEvent(receipt, 'AssetRouterRevoked', {
                    assetRouter: assetRouterVelodrome.address
                })
            })
        })
    })
    describe('Strategies', () => {
        describe('revokes', () => {
            before(async () => {
                await autoStrategyFactory.approveAssetRouter(assetRouterVelodrome.address, {
                    from: admin
                })
            })
            after(async () => {
                await autoStrategyFactory.revokeAssetRouter(assetRouterVelodrome.address, {
                    from: admin
                })
            })
            it('cannot create strategy if one of the assetRouters is not approved', async () => {
                await expectRevert(
                    autoStrategyFactory.createStrategy(
                        [
                            { pool: pool1, assetRouter: assetRouterVelodrome.address },
                            { pool: pool2, assetRouter: assetRouterVelodrome2.address }
                        ],
                        {
                            from: admin
                        }
                    ),
                    'ASSET_ROUTER_NOT_APPROVED'
                )
            })
        })
        describe('createStrategy', () => {
            let receipt
            before(async () => {
                await autoStrategyFactory.approveAssetRouter(assetRouterVelodrome.address, {
                    from: admin
                })
                await autoStrategyFactory.approveAssetRouter(assetRouterVelodrome2.address, {
                    from: admin
                })
            })
            after(async () => {
                await autoStrategyFactory.revokeAssetRouter(assetRouterVelodrome.address, {
                    from: admin
                })
                await autoStrategyFactory.revokeAssetRouter(assetRouterVelodrome2.address, {
                    from: admin
                })
            })
            it('can createStrategy', async () => {
                receipt = await autoStrategyFactory.createStrategy(
                    [
                        { pool: pool1, assetRouter: assetRouterVelodrome.address },
                        { pool: pool2, assetRouter: assetRouterVelodrome2.address }
                    ],
                    {
                        from: admin
                    }
                )
            })
            it('fires event', async () => {
                const autoStrategyAddress = await autoStrategyFactory.autoStrategies(0)

                expectEvent(receipt, 'AutoStrategyDeployed', {
                    autoStrategy: autoStrategyAddress
                })
            })
            it('can deposit into the strategy', async () => {
                const autoStrategyAddress = await autoStrategyFactory.autoStrategies(0)

                const autoStrategy = await AutoStrategy.at(autoStrategyAddress)

                const id = await autoStrategy.poolID()

                const data = await autoStrategy.pools(id)

                const tokenA = await IERC20.at(data.tokenA)
                const tokenB = await IERC20.at(data.tokenB)

                await tokenA.approve(autoStrategy.address, amounts[1], {
                    from: account1
                })
                await tokenB.approve(autoStrategy.address, amounts[1], {
                    from: account1
                })

                await autoStrategy.deposit(id, amounts[1], amounts[1], 0, 0, account1, account1, { from: account1 })
            })
            it('updates autoStrategiesLength', async () => {
                const autoStrategiesLength = await autoStrategyFactory.autoStrategiesLength()

                assert.equal(autoStrategiesLength.toString(), '1', 'autoStrategiesLength is not set correctly')
            })
        })
    })
    describe('Upgrades', () => {
        let implementationV2
        before(async () => {
            implementationV2 = await AutoStrategyV2.new()
        })
        it('upgrades', async () => {
            const receipt = await autoStrategyFactory.upgradeStrategies(implementationV2.address, { from: admin })

            const event = receipt.receipt.rawLogs.some((l) => {
                const topic1 = l.topics[0] === web3.utils.keccak256('Upgraded(address)').toLowerCase()
                const topic2 = l.topics[1] === web3.utils.padLeft(implementationV2.address, 64).toLowerCase()
                return topic1 && topic2
            })

            assert.ok(event, `Upgraded${implementationV2.address} event not emitted`)

            // const autoStrategyAddress = await autoStrategyFactory.autoStrategies(0)

            // const autoStrategy = await AutoStrategyV2.at(autoStrategyAddress)

            // assert.equal(await autoStrategy.accessManager(), accessManager.address, 'accessManager changed')
            // assert.equal(await autoStrategy.factory(), autoStrategyFactory.address, 'factory changed')
            // assert.equal(await autoStrategy.version(), 2, 'Strategy not upgraded')
        })
        it('returns back to previous version', async () => {
            implementationV1 = await AutoStrategy.new()
            const receipt = await autoStrategyFactory.upgradeStrategies(implementationV1.address, { from: admin })

            const event = receipt.receipt.rawLogs.some((l) => {
                const topic1 = l.topics[0] === web3.utils.keccak256('Upgraded(address)').toLowerCase()
                const topic2 = l.topics[1] === web3.utils.padLeft(implementationV1.address, 64).toLowerCase()
                return topic1 && topic2
            })

            assert.ok(event, `Upgraded${implementationV1.address} event not emitted`)

            const autoStrategyAddress = await autoStrategyFactory.autoStrategies(0)

            const autoStrategy = await AutoStrategy.at(autoStrategyAddress)

            assert.equal(await autoStrategy.accessManager(), accessManager.address, 'accessManager changed')
            assert.equal(await autoStrategy.factory(), autoStrategyFactory.address, 'factory changed')
        })
    })
})
