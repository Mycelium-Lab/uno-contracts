const { expectRevert, expectEvent } = require('@openzeppelin/test-helpers')

const AccessManager = artifacts.require('UnoAccessManager')
const FarmFactory = artifacts.require('UnoFarmFactory')
const Farm = artifacts.require('Farm')
const FarmV2 = artifacts.require('FarmV2')
const AssetRouter = artifacts.require('AssetRouter')
const UpgradeableBeacon = artifacts.require('UpgradeableBeacon')

contract('FarmFactory', (accounts) => {
    const lpStakingPool = '0x1111111111111111111111111111111111111111'

    let accessManager
    let implementation
    let assetRouter
    let factory
    let farm

    before(async () => {
        implementation = await Farm.new()
        accessManager = await AccessManager.new({ from: accounts[0] })
        assetRouter = await AssetRouter.new()
        factory = await FarmFactory.new(implementation.address, accessManager.address, assetRouter.address)
    })

    describe('Initializes variables', () => {
        it('Sets accessManager', async () => {
            assert.equal(
                await factory.accessManager(),
                accessManager.address,
                'accessManager not set'
            )
        })

        it('Sets assetManager', async () => {
            assert.equal(
                await factory.assetRouter(),
                assetRouter.address,
                'assetRouter not set'
            )
        })
    })

    describe('Initializes AssetRouter', () => {
        it('Sets accessManager', async () => {
            assert.equal(
                await assetRouter.accessManager(),
                accessManager.address,
                'accessManager not set'
            )
        })

        it('Sets factory', async () => {
            assert.equal(
                await assetRouter.factory(),
                factory.address,
                'factory not set'
            )
        })
    })

    describe('Beacon', () => {
        let farmBeacon
        before(async () => {
            const farmBeaconAddress = await factory.farmBeacon()
            farmBeacon = await UpgradeableBeacon.at(farmBeaconAddress)
        })
        it('Sets implementation', async () => {
            assert.equal(
                await farmBeacon.implementation(),
                implementation.address,
                'Implementation wrongly set'
            )
        })
        it('Has factory as owner', async () => {
            assert.equal(
                await farmBeacon.owner(),
                factory.address,
                'Beacon owner wrongly set'
            )
        })
        it('restricts access to upgradeTo', async () => {
            await expectRevert(
                farmBeacon.upgradeTo(lpStakingPool),
                'Ownable: caller is not the owner'
            )
        })
    })

    describe('Deploys farm', () => {
        it('Deploys farm', async () => {
            const receipt = await factory.createFarm(lpStakingPool)
            assert.equal(
                await factory.poolLength(),
                1,
                'poolLength not increased'
            )
            assert.equal(
                await factory.pools(0),
                lpStakingPool,
                'Wrong lpStakingPool'
            )
            const farmAddress = await factory.Farms(lpStakingPool)
            expectEvent(receipt, 'FarmDeployed', { farmAddress })
            farm = await Farm.at(farmAddress)
        })
        it('Reverts if farm exists', async () => {
            await expectRevert(
                factory.createFarm(lpStakingPool),
                'FARM_EXISTS'
            )
        })
        it('Initializes farm', async () => {
            assert.equal(
                await farm.lpStakingPool(),
                lpStakingPool,
                'lpStakingPool wrongly set'
            )
            assert.equal(
                await farm.assetRouter(),
                assetRouter.address,
                'assetRouter wrongly set'
            )
            assert.equal(
                await farm.version(),
                1,
                'Wrong farm version'
            )
        })
    })

    describe('Upgrades farm', () => {
        let implementationV2
        before(async () => {
            implementationV2 = await FarmV2.new()
        })
        it('Reverts if called not by an admin', async () => {
            await expectRevert(
                factory.upgradeFarms(implementationV2.address, { from: accounts[1] }),
                'CALLER_NOT_ADMIN'
            )
        })
        it('Upgrades farms', async () => {
            const receipt = await factory.upgradeFarms(implementationV2.address, { from: accounts[0] })

            // expectEvent(receipt, 'Upgraded', {implementation: implementationV2.address}) doesn't work because transaction receipt logs only include events emitted in the context of the direct contract function being called
            const event = receipt.receipt.rawLogs.some((l) => {
                const topic1 = l.topics[0] === web3.utils.keccak256('Upgraded(address)').toLowerCase()
                const topic2 = l.topics[1] === web3.utils.padLeft(implementationV2.address, 64).toLowerCase()
                return (topic1 && topic2)
            })
            assert.ok(event, `Upgraded${implementationV2.address} event not emitted`)

            assert.equal(
                await farm.lpStakingPool(),
                lpStakingPool,
                'lpStakingPool changed'
            )
            assert.equal(
                await farm.assetRouter(),
                assetRouter.address,
                'lpStakingPool changed'
            )
            assert.equal(
                await farm.version(),
                2,
                'Farms not upgraded'
            )
        })
    })
})
