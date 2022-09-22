// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import { IUnoFarmTrisolarisStable as Farm } from "./interfaces/IUnoFarmTrisolarisStable.sol";
import "../../interfaces/IUnoFarmFactory.sol";
import "../../interfaces/IUnoAccessManager.sol";
import "../../interfaces/ISwap.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract UnoAssetRouterTrisolarisStable is Initializable, PausableUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @dev Contract Variables:
     * farmFactory - The contract that deploys new Farms and links them to {swap}s.
     * accessManager - Role manager contract.
     */
    IUnoFarmFactory public farmFactory;
    IUnoAccessManager public accessManager;

    bytes32 private ADMIN_ROLE;
    bytes32 private constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    bytes32 private constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public fee;

    event Deposit(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);

    event FeeChanged(uint256 previousFee, uint256 newFee);

    modifier onlyRole(bytes32 role){
        require(accessManager.hasRole(role, msg.sender), 'CALLER_NOT_AUTHORIZED');
        _;
    }

    // ============ Methods ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _accessManager, address _farmFactory) external initializer {
        require (_accessManager != address(0), 'BAD_ACCESS_MANAGER');
        require (_farmFactory != address(0), 'BAD_FARM_FACTORY');

        __Pausable_init();
        accessManager = IUnoAccessManager(_accessManager);
        farmFactory = IUnoFarmFactory(_farmFactory);

        ADMIN_ROLE = accessManager.ADMIN_ROLE();
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {swap} and deposits tokens in it. Emits a {Deposit} event.
     * @param swap - Address of the Swap contract.
     * @param amounts - Amounts of tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {{amounts}} deposit.
     * @param amountLP - Amount of LP tokens to deposit.
     * @param recipient - Address which will receive the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(
        address swap,
        uint256[] memory amounts,
        uint256 minAmountLP,
        uint256 amountLP,
        address recipient
    ) external whenNotPaused returns (uint256 liquidity) {
        Farm farm = Farm(farmFactory.Farms(swap));
        if (farm == Farm(address(0))) {
            farm = Farm(farmFactory.createFarm(swap));
        }

        for (uint256 i = 0; i < amounts.length; i++) { 
            if (amounts[i] > 0) {
                IERC20Upgradeable(farm.tokens(i)).safeTransferFrom(msg.sender, address(farm), amounts[i]); 
            }
        }

        if (amountLP > 0) {
            IERC20Upgradeable(farm.lpPair()).safeTransferFrom(msg.sender, address(farm), amountLP);
        }
 
        liquidity = farm.deposit(amounts, minAmountLP, amountLP, recipient);
        emit Deposit(swap, msg.sender, recipient, liquidity);
    }

    /** 
     * @dev Withdraws tokens from the given pool. Emits a {Withdraw} event.
     * @param swap - Address of the Swap contract.
     * @param amount - Amounts of LP tokens to withdraw.
     * @param minAmounts - Minimum amounts of tokens sent to {recipient}.
     * @param withdrawLP - Whether to withdraw or not to withdraw the deposits in LP tokens.
     * @param recipient - The address which will receive tokens.

     * @return amounts - Token amounts sent to {recipient}, an array of zeros if withdrawLP == false.
     */
    function withdraw(
        address swap,
        uint256 amount,
        uint256[] memory minAmounts,
        bool withdrawLP,
        address recipient
    ) external returns (uint256[] memory amounts) {
        Farm farm = Farm(farmFactory.Farms(swap));
        require(farm != Farm(address(0)), "FARM_NOT_EXISTS");

        amounts = farm.withdraw(amount, minAmounts, withdrawLP, msg.sender, recipient);
        emit Withdraw(swap, msg.sender, recipient, amount);
    }

    /**
     * @dev Distributes tokens between users.
     * @param swap - Address of the Swap contract.

     * @param rewardSwapInfos - Arrays of structs with token arrays describing swap routes from reward to tokens in {swap} and minimum amounts of output tokens that must be received for the transaction not to revert.
     * @param rewarderSwapInfos - Arrays of structs with token arrays describing swap routes from rewarder to tokens in {swap} and minimum amounts of output tokens that must be received for the transaction not to revert.
     * @param feeSwapInfos - Arrays of structs with token arrays describing swap routes (rewardTokenToFeeToken, rewarderTokenToFeeToken) and minimum amounts of output tokens that must be received for the transaction not to revert.
     * @param feeTo - Address to collect fees to.
     *
     * Note: This function can only be called by the distributor.
     */
    function distribute(
        address swap,
        Farm.SwapInfo[] calldata rewardSwapInfos,
        Farm.SwapInfo[] calldata rewarderSwapInfos,
        Farm.SwapInfo[2] calldata feeSwapInfos,
        address feeTo
    ) external whenNotPaused onlyRole(DISTRIBUTOR_ROLE) {
        Farm farm = Farm(farmFactory.Farms(swap));
        require(farm != Farm(address(0)), "FARM_NOT_EXISTS");

        uint256 reward = farm.distribute(
            rewardSwapInfos,
            rewarderSwapInfos,
            feeSwapInfos,
            Farm.FeeInfo(feeTo, fee)
        );
        emit Distribute(swap, reward);
    }

    /**
     * @dev Returns tokens staked by the {_address} for the given {swap}.
     * @param _address - The address to check stakes for.
     * @param swap - Address of the Swap contract.

     * @return stakeLP - Total user stake(in LP tokens).
     */
    function userStake(address _address, address swap) external view returns (uint256 stakeLP) {
        Farm farm = Farm(farmFactory.Farms(swap));
        if (farm != Farm(address(0))) {
            stakeLP = farm.userBalance(_address);
        }
    }

    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     * @param swap - Address of the Swap contract.

     * @return totalDepositsLP - Total deposits (in LP tokens).
     */
    function totalDeposits(address swap) external view returns (uint256 totalDepositsLP) {
        Farm farm = Farm(farmFactory.Farms(swap));
        if (farm != Farm(address(0))) {
            totalDepositsLP = farm.getTotalDeposits();
        }
    }

    /**
     * @dev Returns addresses of tokens in {swap}.
     * @param swap - Swap to check tokens in.

     * @return tokens - Array of token addresses.
     */  
    function getTokens(address swap) external view returns(IERC20[] memory tokens){
        uint8 tokenCount;
        address[] memory _tokens = new address[](type(uint8).max);
        for (uint8 i = 0; i < type(uint8).max; i++) {
            try ISwap(swap).getToken(i) returns (address token) {
                _tokens[i] = token;
                tokenCount++;
            } catch (bytes memory /*lowLevelData*/) {
                break;
            }
        }
        require(tokenCount > 0, "NO_TOKENS_IN_SWAP");

        tokens = new IERC20[](tokenCount);
        for (uint8 i = 0; i < tokenCount; i++) {
            tokens[i] = IERC20(_tokens[i]);
        }
        return tokens;
    }

    /**
     * @dev Change fee amount.
     * @param _fee -New fee to collect from farms. [10^18 == 100%]
     *
     * Note: This function can only be called by ADMIN_ROLE.
     */ 
    function setFee(uint256 _fee) external onlyRole(accessManager.ADMIN_ROLE()){
        require (_fee <= 1 ether, "BAD_FEE");
        if(fee != _fee){
            emit FeeChanged(fee, _fee); 
            fee = _fee;
        }
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _authorizeUpgrade(address) internal override onlyRole(ADMIN_ROLE) {}
}
