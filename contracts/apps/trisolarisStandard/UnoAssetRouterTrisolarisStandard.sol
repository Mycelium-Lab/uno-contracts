// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import { IUnoFarmTrisolarisStandard as Farm } from "./interfaces/IUnoFarmTrisolarisStandard.sol";
import "../../interfaces/IUnoFarmFactory.sol";
import "../../interfaces/IUnoAccessManager.sol";
import "../../interfaces/IUniswapV2Pair.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract UnoAssetRouterTrisolarisStandard is Initializable, PausableUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @dev Contract Variables:
     * farmFactory - The contract that deploys new Farms and links them to {lpPair}s.
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
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPair} and deposits tokens in it. Emits a {Deposit} event.
     * @param lpPair - Address of the pool to deposit tokens in.
     * @param amountA  - Token A amount to deposit.
     * @param amountB -  Token B amount to deposit.
     * @param amountAMin - Bounds the extent to which the B/A price can go up before the transaction reverts.
     * @param amountBMin - Bounds the extent to which the A/B price can go up before the transaction reverts.
     * @param amountLP - Additional LP Token amount to deposit.
     * @param recipient - Address which will receive the deposit.
     
     * @return sentA - Token A amount sent to the farm.
     * @return sentB - Token B amount sent to the farm.
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(
        address lpPair,
        uint256 amountA,
        uint256 amountB,
        uint256 amountAMin,
        uint256 amountBMin,
        uint256 amountLP,
        address recipient
    ) external whenNotPaused returns (uint256 sentA, uint256 sentB, uint256 liquidity) {
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if (farm == Farm(address(0))) {
            farm = Farm(farmFactory.createFarm(lpPair));
        }

        if (amountA > 0) {
            IERC20Upgradeable(farm.tokenA()).safeTransferFrom(msg.sender, address(farm), amountA);
        }
        if (amountB > 0) {
            IERC20Upgradeable(farm.tokenB()).safeTransferFrom(msg.sender, address(farm), amountB);
        }
        if (amountLP > 0) {
            IERC20Upgradeable(lpPair).safeTransferFrom(msg.sender, address(farm), amountLP);
        }

        (sentA, sentB, liquidity) = farm.deposit(
            amountA,
            amountB,
            amountAMin,
            amountBMin,
            amountLP,
            msg.sender,
            recipient
        );
        emit Deposit(lpPair, msg.sender, recipient, liquidity);
    }

    /** 
     * @dev Withdraws tokens from the given pool. Emits a {Withdraw} event.
     * @param lpPair - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param amountAMin - The minimum amount of tokenA that must be received for the transaction not to revert.
     * @param amountBMin - The minimum amount of tokenB that must be received for the transaction not to revert.
     * @param withdrawLP - True: Withdraw in LP tokens, False: Withdraw in normal tokens.
     * @param recipient - The address which will receive tokens.

     * @return amountA - Token A amount sent to the {recipient}, 0 if withdrawLP == false.
     * @return amountB - Token B amount sent to the {recipient}, 0 if withdrawLP == false.
     */
    function withdraw(
        address lpPair,
        uint256 amount,
        uint256 amountAMin,
        uint256 amountBMin,
        bool withdrawLP,
        address recipient
    ) external returns (uint256 amountA, uint256 amountB) {
        Farm farm = Farm(farmFactory.Farms(lpPair));
        require(farm != Farm(address(0)), "FARM_NOT_EXISTS");

        (amountA, amountB) = farm.withdraw(
            amount,
            amountAMin,
            amountBMin,
            withdrawLP,
            msg.sender,
            recipient
        );
        emit Withdraw(lpPair, msg.sender, recipient, amount);
    }

    /**
     * @dev Distributes tokens between users.
     * @param lpPair - LP pool to distribute tokens in.
     * @param swapInfos - Arrays of structs with token arrays describing swap routes (rewardTokenToTokenA, rewardTokenToTokenB, rewarderTokenToTokenA, rewarderTokenToTokenB) and minimum amounts of output tokens that must be received for the transaction not to revert.
     * @param feeSwapInfos - Arrays of structs with token arrays describing swap routes (rewardTokenToFeeToken, rewarderTokenToFeeToken) and minimum amounts of output tokens that must be received for the transaction not to revert.
     * @param feeTo - Address to collect fees to.
     *
     * Note: This function can only be called by the distributor.
     */
    function distribute(
        address lpPair,
        Farm.SwapInfo[4] calldata swapInfos,
        Farm.SwapInfo[2] calldata feeSwapInfos,
        address feeTo
    ) external whenNotPaused onlyRole(DISTRIBUTOR_ROLE) {
        Farm farm = Farm(farmFactory.Farms(lpPair));
        require(farm != Farm(address(0)), "FARM_NOT_EXISTS");

        uint256 reward = farm.distribute(swapInfos, feeSwapInfos, Farm.FeeInfo(feeTo, fee));
        emit Distribute(lpPair, reward);
    }

    /**
     * @dev Returns tokens staked by the {_address} for the given {lpPair}.
     * @param _address - The address to check stakes for.
     * @param lpPair - LP pool to check stakes in.

     * @return stakeLP - Total user stake(in LP tokens).
     * @return stakeA - Token A stake.
     * @return stakeB - Token B stake.
     */
    function userStake(address _address, address lpPair) external view returns (uint256 stakeLP, uint256 stakeA, uint256 stakeB) {
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if (farm != Farm(address(0))) {
            stakeLP = farm.userBalance(_address);
            (stakeA, stakeB) = getTokenStake(lpPair, stakeLP);
        }
    }

    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     * @param lpPair - LP pool to check total deposits in.

     * @return totalDepositsLP - Total deposits (in LP tokens).
     * @return totalDepositsA - Token A deposits.
     * @return totalDepositsB - Token B deposits.
     */
    function totalDeposits(address lpPair) external view returns (uint256 totalDepositsLP, uint256 totalDepositsA, uint256 totalDepositsB) {
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if (farm != Farm(address(0))) {
            totalDepositsLP = farm.getTotalDeposits();
            (totalDepositsA, totalDepositsB) = getTokenStake(lpPair, totalDepositsLP);
        }
    }

    /**
     * @dev Returns addresses of tokens in {lpPair}.
     * @param lpPair - LP pair to check tokens in.

     * @return tokenA - Token A address.
     * @return tokenB - Token B address.
     */
    function getTokens(address lpPair) external view returns (address tokenA, address tokenB) {
        tokenA = IUniswapV2Pair(lpPair).token0();
        tokenB = IUniswapV2Pair(lpPair).token1();
    }

    /**
     * @dev Converts LP tokens to normal tokens, value(amountA) == value(amountB) == 0.5*amountLP
     * @param lpPair - LP pair for conversion.
     * @param amountLP - Amount of LP tokens to convert.

     * @return amountA - Token A amount.
     * @return amountB - Token B amount.
     */
    function getTokenStake(address lpPair, uint256 amountLP) internal view returns (uint256 amountA, uint256 amountB) {
        uint256 totalSupply = IERC20Upgradeable(lpPair).totalSupply();
        amountA = amountLP * IERC20Upgradeable(IUniswapV2Pair(lpPair).token0()).balanceOf(lpPair) / totalSupply;
        amountB = amountLP * IERC20Upgradeable(IUniswapV2Pair(lpPair).token1()).balanceOf(lpPair) / totalSupply;
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

    function _authorizeUpgrade(address) internal override onlyRole(ADMIN_ROLE) {
        
    }
}
