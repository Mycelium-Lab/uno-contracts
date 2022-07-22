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
     * farmFactory - The contract that deploys new Farms and links them to {lpPair}s.
     * accessManager - Role manager contract.
     */
    IUnoFarmFactory public farmFactory;
    IUnoAccessManager public accessManager;
    bytes32 private constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    bytes32 private constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    event Deposit(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);

    modifier onlyDistributor() {
        require(accessManager.hasRole(DISTRIBUTOR_ROLE, msg.sender), "CALLER_NOT_DISTRIBUTOR");
        _;
    }
    modifier onlyPauser() {
        require(accessManager.hasRole(PAUSER_ROLE, msg.sender), "CALLER_NOT_PAUSER");
        _;
    }
    modifier onlyAdmin() {
        require(accessManager.hasRole(accessManager.ADMIN_ROLE(), msg.sender), "CALLER_NOT_ADMIN");
        _;
    }

    // ============ Methods ============

    function initialize(address _accessManager, address _farmFactory) external initializer {
        __Pausable_init();
        accessManager = IUnoAccessManager(_accessManager);
        farmFactory = IUnoFarmFactory(_farmFactory);
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPair} and deposits tokens in it. Emits a {Deposit} event.
     * @param swap - Address of the Swap contract.
     * @param amounts - Amounts of tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {{amounts}} deposit.
     * @param amountLP - Amount of LP tokens to deposit.
     * @param recipient - Address which will recieve the deposit.

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
     * @param recipient - The address which will recieve tokens.

     * @return amounts - Token amounts sent to {recipient}, an array of zeros if withdrawLP == false.
     */
    function withdraw(
        address swap,
        uint256 amount,
        uint256[] memory minAmounts,
        bool withdrawLP,
        address recipient
    ) external whenNotPaused returns (uint256[] memory amounts) {
        Farm farm = Farm(farmFactory.Farms(swap));
        require(farm != Farm(address(0)), "FARM_NOT_EXISTS");

        amounts = farm.withdraw(amount, minAmounts, withdrawLP, msg.sender, recipient);
        emit Withdraw(swap, msg.sender, recipient, amount);
    }

    /**
     * @dev Distributes tokens between users.
     * @param swap - Address of the Swap contract.
     * @param rewardTokenRoutes An array of reward token addresses.
     * @param rewarderTokenRoutes An array of rewarder token addresses.
     * @param rewardAmountsOutMin  An array of minimum amounts of reward tokens.
     * @param rewarderAmountsOutMin An array of minimum amounts of rewarder tokens.
     *
     * Note: This function can only be called by the distributor.
     */
    function distribute(
        address swap,
        address[][] calldata rewardTokenRoutes,
        address[][] calldata rewarderTokenRoutes,
        uint256[] calldata rewardAmountsOutMin,
        uint256[] calldata rewarderAmountsOutMin
    ) external whenNotPaused onlyDistributor {
        Farm farm = Farm(farmFactory.Farms(swap));
        require(farm != Farm(address(0)), "FARM_NOT_EXISTS");

        uint256 reward = farm.distribute(
            rewardTokenRoutes,
            rewarderTokenRoutes,
            rewardAmountsOutMin,
            rewarderAmountsOutMin
        );
        emit Distribute(swap, reward);
    }

    /**
     * @dev Returns tokens staked by the {_address} for the given {lpPair}.
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
     * @param swap - LP pool to check tokens in.

     * @return tokens - Token address.
     */  
    function getTokens(address swap) external view returns(address[] memory tokens){
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

        tokens = new address[](tokenCount);
        for (uint8 i = 0; i < tokenCount; i++) {
            tokens[i] = _tokens[i];
        }
        return tokens;
    }

    function pause() external onlyPauser {
        _pause();
    }

    function unpause() external onlyPauser {
        _unpause();
    }

    function _authorizeUpgrade(address) internal override onlyAdmin {}
}
