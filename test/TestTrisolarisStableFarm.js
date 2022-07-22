const { expectEvent, expectRevert, BN, constants } = require("@openzeppelin/test-helpers");
const IUniversalMasterChef = artifacts.require("IUniversalMasterChef");
const IComplexRewarder = artifacts.require("IComplexRewarder");
const IERC20 = artifacts.require("IERC20");

const Farm = artifacts.require("UnoFarmTrisolarisStable");

const swap = "0x458459E48dbAC0C8Ca83F8D0b7b29FEfE60c3970"; // USDC-USDT-USN
const lpTokenAddress = "0x87BCC091d0A7F9352728100268Ac8D25729113bB";
const poolTokenAddresses = [
    "0xb12bfca5a55806aaf64e99521918a4bf0fc40802",
    "0x4988a896b1227218e4a686fde5eabdcabd91571f",
    "0x5183e1b1091804bc2602586919e6880ac1cf2896",
]; // USDC, USDT, USN (in that order)

const masterChefV2 = "0x3838956710bcc9D122Dd23863a0549ca8D5675D6";

contract("Test UnoFarmTrisolarisStable initialization", accounts => {
    let assetRouter = accounts[0];
    let implementation;
    let lpToken;
    let pid;
    let rewardTokenAddress, rewarderTokenAddress;
    let receipt;

    before(async () => {
        implementation = await Farm.new({ from: accounts[0] });

        receipt = await implementation.initialize(swap, assetRouter, { from: accounts[0] });

        const MasterChef = await IUniversalMasterChef.at(masterChefV2);

        const poolLengthV2 = await MasterChef.poolLength();

        for (let i = 0; i < poolLengthV2.toNumber(); i++) {
            const lpToken = await MasterChef.lpToken(i);
            if (lpToken.toString() === lpTokenAddress) {
                pid = i;
                poolFound = true;
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
    });

    describe("Emits initialize event", () => {
        it("fires events", async () => {
            expectEvent(receipt, "Initialized", { version: new BN(1) });
        });
    });

    describe("Can't call multiple initializations", () => {
        it("Reverts", async () => {
            await expectRevert(
                implementation.initialize(swap, assetRouter, { from: accounts[0] }),
                "Initializable: contract is already initialized",
            );
        });
    });

    describe("Initializes variables", () => {
        it("Sets lpPair", async () => {
            assert.equal(await implementation.lpPair(), lpToken.address, "LP token is not correct");
        });
        it("Sets correct pid", async () => {
            assert.equal((await implementation.pid()).toNumber(), pid, "Pid not correct");
        });
        it("Sets rewardToken", async () => {
            assert.equal(
                (await implementation.rewardToken()).toString(),
                rewardTokenAddress,
                "Reward token is not correct",
            );
        });
        it("Sets rewarderToken", async () => {
            assert.equal(
                (await implementation.rewarderToken()).toString(),
                rewarderTokenAddress,
                "Rewarder token is not correct",
            );
        });
        it("Sets tokens", async () => {
            const tokensLength = (await implementation.tokensLength()).toNumber();
            assert.equal(tokensLength, poolTokenAddresses.length, "Wrong number of tokens");
            for (let i = 0; i < tokensLength; i++) {
                assert.equal(
                    poolTokenAddresses[i].toLowerCase(),
                    (await implementation.tokens(i)).toString().toLowerCase(),
                    "Tokens are not correct",
                );
            }
        });
        it("Sets assetRouter", async () => {
            assert.equal(
                await implementation.assetRouter(),
                assetRouter,
                "assetRouter is not correct",
            );
        });
    });
    describe("Functions available only for asset router", () => {
        //CALLER_NOT_ASSET_ROUTER check fails
        it("Prevents function calls for not asset router", async () => {
            await expectRevert(
                implementation.deposit([0, 0, 0], 0, 0, constants.ZERO_ADDRESS, {
                    from: accounts[1],
                }),
                "CALLER_NOT_ASSET_ROUTER",
            );
            await expectRevert(
                implementation.withdraw(
                    0,
                    [0, 0, 0],
                    false,
                    constants.ZERO_ADDRESS,
                    constants.ZERO_ADDRESS,
                    {
                        from: accounts[1],
                    },
                ),
                "CALLER_NOT_ASSET_ROUTER",
            );
            await expectRevert(
                implementation.distribute(
                    [[constants.ZERO_ADDRESS], [constants.ZERO_ADDRESS]],
                    [[constants.ZERO_ADDRESS], [constants.ZERO_ADDRESS]],
                    [0, 0, 0, 0],
                    [0, 0, 0, 0],
                    { from: accounts[1] },
                ),
                "CALLER_NOT_ASSET_ROUTER",
            );
        });
    });
});
