const { expectRevert, expectEvent } = require('@openzeppelin/test-helpers')

const AccessManager = artifacts.require('UnoAccessManager')

contract('UnoAccessManager', (accounts) => {
    let accessManager
    before(async () => {
        accessManager = await AccessManager.new({ from: accounts[0] })
    })
    describe('Admin role', () => {
        it('Admin role is 0x00', async () => {
            assert.equal(
                web3.utils.hexToNumberString(await accessManager.ADMIN_ROLE()),
                web3.utils.hexToNumberString('0x00'),
                'ADMIN_ROLE is not 0x00'
            )
        })

        it('Deployer is admin', async () => {
            assert.equal(
                await accessManager.hasRole('0x00', accounts[0]),
                true,
                "Admin role wasn't set"
            )
        })
    })
    const role = '0x01'
    const account = '0x0000000000000000000000000000000000000000'
    describe('Grants role', () => {
        it('Reverts if called by not admin', async () => {
            await expectRevert(
                accessManager.grantRole(role, account, { from: accounts[1] }),
                'CALLER_NOT_ADMIN'
            )
        })

        it('Grants role and emits event', async () => {
            const receipt = await accessManager.grantRole(role, account, { from: accounts[0] })
            expectEvent(receipt, 'RoleGranted', { role: web3.utils.padRight(role, 64), account })
            assert.equal(
                await accessManager.hasRole(role, account),
                true,
                "Role wasn't granted"
            )
        })

        it("Doesn't emit event if role already granted", async () => {
            const receipt = await accessManager.grantRole(role, account, { from: accounts[0] })
            expectEvent.notEmitted(receipt, 'RoleGranted')
            assert.equal(
                await accessManager.hasRole(role, account),
                true,
                'Role removed'
            )
        })
    })
    describe('Revokes role', () => {
        it('Reverts if called by not admin', async () => {
            await expectRevert(
                accessManager.revokeRole(role, account, { from: accounts[1] }),
                'CALLER_NOT_ADMIN'
            )
        })

        it('Revokes role and emits event', async () => {
            const receipt = await accessManager.revokeRole(role, account, { from: accounts[0] })
            expectEvent(receipt, 'RoleRevoked', { role: web3.utils.padRight(role, 64), account })
            assert.equal(
                await accessManager.hasRole(role, account),
                false,
                "Role wasn't granted"
            )
        })

        it("Doesn't emit event if role already revoked", async () => {
            const receipt = await accessManager.revokeRole(role, account, { from: accounts[0] })
            expectEvent.notEmitted(receipt, 'RoleRevoked')
            assert.equal(
                await accessManager.hasRole(role, account),
                false,
                'Role granted'
            )
        })
    })
})
