// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import { IUnoFarmTrisolarisStable as Farm } from "../interfaces/IUnoFarmTrisolarisStable.sol";
import "../../../interfaces/IUnoFarmFactory.sol";
import "../../../interfaces/IUnoAccessManager.sol";
import "../../../interfaces/ISwap.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract UnoAssetRouterTrisolarisStableV2 is Initializable, PausableUpgradeable, UUPSUpgradeable {
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

    uint256 public constant version = 2;

    event Deposit(
        address indexed swap,
        address indexed from,
        address indexed recipient,
        uint256 amount
    );
    event Withdraw(
        address indexed swap,
        address indexed from,
        address indexed recipient,
        uint256 amount
    );
    event Distribute(address indexed swap, uint256 reward);

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
     * @param minAamountToMint - Minimum amount of LP tokens to receive.
     * @param amountLP - Amount of LP tokens to deposit.
     * @param recipient - Recipient.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(
        address swap,
        uint256[] memory amounts,
        uint256 minAamountToMint,
        uint256 amountLP,
        address recipient
    ) external whenNotPaused returns (uint256 liquidity) {
        address lpPair = getLpPair(swap);

        Farm farm = Farm(farmFactory.Farms(swap));
        if (farm == Farm(address(0))) {
            farm = Farm(farmFactory.createFarm(swap));
        }

        address[] memory poolTokens = farm.getPoolTokens();
        uint256 tokensCount = poolTokens.length;

        require(amounts.length == tokensCount, "WRONG_NUMBER_OF_TOKENS");

        for (uint256 i = 0; i < tokensCount; i++) {
            if (amounts[i] > 0) {
                IERC20Upgradeable(poolTokens[i]).safeTransferFrom(
                    msg.sender,
                    address(farm),
                    amounts[i]
                );
            }
        }

        if (amountLP > 0) {
            IERC20Upgradeable(lpPair).safeTransferFrom(msg.sender, address(farm), amountLP);
        }

        liquidity = farm.deposit(amounts, minAamountToMint, amountLP, recipient);
        emit Deposit(swap, msg.sender, recipient, liquidity);
        return liquidity;
    }

    /** 
     * @dev Withdraws tokens from the given pool. Emits a {Withdraw} event.
     * @param swap - Address of the Swap contract.
     * @param amount - Amounts of LP tokens to withdraw.
     * @param minAmounts - Minimum amounts of tokens to receive.
     * @param withdrawLP - Whether to withdraw or not to withdraw the deposits in LP tokens.
     * @param recipient - Recipient.

     * @return amountsWitdrawn - Token amounts sent to the {recipient}, an array of zeros if withdrawLP == false.
     */
    function withdraw(
        address swap,
        uint256 amount,
        uint256[] memory minAmounts,
        bool withdrawLP,
        address recipient
    ) external whenNotPaused returns (uint256[] memory amountsWitdrawn) {
        Farm farm = Farm(farmFactory.Farms(swap));
        require(farm != Farm(address(0)), "FARM_NOT_EXISTS");

        address[] memory poolTokens = farm.getPoolTokens();
        uint256 tokensCount = poolTokens.length;

        require(minAmounts.length == tokensCount, "WRONG_NUMBER_OF_TOKENS");

        amountsWitdrawn = farm.withdraw(amount, minAmounts, withdrawLP, msg.sender, recipient);
        emit Withdraw(swap, msg.sender, recipient, amount);
    }

    /**
     * @dev Distributes tokens between users.
     * @param swap - Address of the Swap contract.
     * @param _rewarderTokenRoutes An array of rewarder token addresses.
     * @param _rewardTokenRoutes An array of reward token addresses.
     * @param rewarderAmountsOutMin An array of minimum amounts of rewarder tokens.
     * @param rewardAmountsOutMin  An array of minimum amounts of reward tokens.
     *
     * Note: This function can only be called by the distributor.
     */
    function distribute(
        address swap,
        address[][] calldata _rewarderTokenRoutes,
        address[][] calldata _rewardTokenRoutes,
        uint256[] calldata rewarderAmountsOutMin,
        uint256[] calldata rewardAmountsOutMin
    ) external whenNotPaused onlyDistributor {
        Farm farm = Farm(farmFactory.Farms(swap));
        require(farm != Farm(address(0)), "FARM_NOT_EXISTS");

        uint256 reward = farm.distribute(
            _rewarderTokenRoutes,
            _rewardTokenRoutes,
            rewarderAmountsOutMin,
            rewardAmountsOutMin
        );
        emit Distribute(swap, reward);
    }

    function getLpPair(address _swap) internal view returns (address) {
        address lpPair;
        (, , , , , , lpPair) = ISwap(_swap).swapStorage();
        return lpPair;
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
     * @dev Utility function used to create tokens array.
     */
    function getTokens(address _swap)
        internal
        returns (address[] memory _poolTokens, uint8 _tokensCount)
    {
        ISwap Swap = ISwap(_swap);

        for (uint8 i = 0; i < type(uint8).max; i++) {
            (bool success, ) = address(Swap).call(abi.encodeWithSignature("getToken(uint8)", i));
            if (success) {
                _tokensCount++;
            } else break;
        }

        require(_tokensCount > 0, "No tokens were found");
        _poolTokens = new address[](_tokensCount);

        for (uint8 i = 0; i < _tokensCount; i++) {
            (, bytes memory data) = address(Swap).call(
                abi.encodeWithSignature("getToken(uint8)", i)
            );
            _poolTokens[i] = abi.decode(data, (address));
        }

        return (_poolTokens, _tokensCount);
    }

    function pause() external onlyPauser {
        _pause();
    }

    function unpause() external onlyPauser {
        _unpause();
    }

    function _authorizeUpgrade(address) internal override onlyAdmin {}
}
