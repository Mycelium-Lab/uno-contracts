// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import {IUnoFarmSushiswap as Farm} from './interfaces/IUnoFarmSushiswap.sol'; 
import '../../interfaces/IUnoFarmFactory.sol';
import '../../interfaces/IUnoAccessManager.sol'; 
import '../../interfaces/IUniswapV2Pair.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';

contract UnoAssetRouterSushiswap is Initializable, PausableUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @dev Contract Variables:
     * farmFactory - The contract that deploys new Farms and links them to {lpPair}s.
     * accessManager - Role manager contract.
     */
    IUnoFarmFactory public farmFactory;
    IUnoAccessManager public accessManager;
    bytes32 private constant DISTRIBUTOR_ROLE = keccak256('DISTRIBUTOR_ROLE');
    bytes32 private constant PAUSER_ROLE = keccak256('PAUSER_ROLE');

    event Deposit(address indexed lpPool, address indexed from, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed from, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);

    modifier onlyDistributor(){
        require(accessManager.hasRole(DISTRIBUTOR_ROLE, msg.sender), 'CALLER_NOT_DISTRIBUTOR');
        _;
    }
    modifier onlyPauser(){
        require(accessManager.hasRole(PAUSER_ROLE, msg.sender), 'CALLER_NOT_PAUSER');
        _;
    }
    modifier onlyAdmin(){
        require(accessManager.hasRole(accessManager.ADMIN_ROLE(), msg.sender), 'CALLER_NOT_ADMIN');
        _;
    }

    // ============ Methods ============

    function initialize(address _accessManager, address _farmFactory) external initializer{
        __Pausable_init();
        accessManager = IUnoAccessManager(_accessManager);
        farmFactory = IUnoFarmFactory(_farmFactory);
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPair} and deposits tokens in it. Emits a {Deposit} event.
     * @param amountA  - Token A amount to deposit.
     * @param amountB -  Token B amount to deposit.
     * @param amountLP - LP Token amount to deposit.
     * @param lpPair - Address of the pool to deposit tokens in.
     * @param recipient - Address which will recieve the deposit and leftover tokens.
     
     * @return sentA - Token A amount sent to the farm.
     * @return sentB - Token B amount sent to the farm.
     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(uint256 amountA, uint256 amountB, uint256 amountLP, address lpPair, address recipient) external whenNotPaused returns(uint256 sentA, uint256 sentB, uint256 liquidity){
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPair));
        }

        if(amountA > 0){
            IERC20Upgradeable(farm.tokenA()).safeTransferFrom(msg.sender, address(farm), amountA);
        }
        if(amountB > 0){
            IERC20Upgradeable(farm.tokenB()).safeTransferFrom(msg.sender, address(farm), amountB);
        }
        if(amountLP > 0){
            IERC20Upgradeable(lpPair).safeTransferFrom(msg.sender, address(farm), amountLP);
        }
        
        (sentA, sentB, liquidity) = farm.deposit(amountA, amountB, amountLP, recipient);
        emit Deposit(lpPair, msg.sender, recipient, liquidity); 
    }

    /** 
     * @dev Withdraws tokens from the given pool. Emits a {Withdraw} event.
     * @param lpPair - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param withdrawLP - True: Withdraw in LP tokens, False: Withdraw in normal tokens.
     * @param recipient - The address which will recieve tokens.

     * @return amountA - Token A amount sent to the {recipient}, 0 if withdrawLP == false.
     * @return amountB - Token B amount sent to the {recipient}, 0 if withdrawLP == false.
     */ 
    function withdraw(address lpPair, uint256 amount, bool withdrawLP, address recipient) external whenNotPaused returns(uint256 amountA, uint256 amountB){
        Farm farm = Farm(farmFactory.Farms(lpPair));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');
        
        (amountA, amountB) = farm.withdraw(msg.sender, amount, withdrawLP, recipient); 
        emit Withdraw(lpPair, msg.sender, recipient, amount);  
    }

    /**
     * @dev Distributes tokens between users.
     * @param lpPair - LP pool to distribute tokens in.
     * @param rewardTokenToTokenARoute An array of token addresses.
     * @param rewardTokenToTokenBRoute An array of token addresses.
     * @param rewarderTokenToTokenARoute An array of token addresses.
     * @param rewarderTokenToTokenBRoute An array of token addresses.
     * @param amountsOutMin The minimum amount of output tokens that must be received for the transaction not to revert.
     *
     * Note: This function can only be called by the distributor.
     */ 
    function distribute(
        address lpPair,
        address[] calldata rewardTokenToTokenARoute,
        address[] calldata rewardTokenToTokenBRoute, 
        address[] calldata rewarderTokenToTokenARoute,
        address[] calldata rewarderTokenToTokenBRoute,
        uint256[4] memory amountsOutMin
    ) external whenNotPaused onlyDistributor {
        Farm farm = Farm(farmFactory.Farms(lpPair));
        require(farm != Farm(address(0)), 'FARM_NOT_EXISTS');

        uint256 reward = farm.distribute(rewardTokenToTokenARoute, rewardTokenToTokenBRoute, rewarderTokenToTokenARoute, rewarderTokenToTokenBRoute, amountsOutMin);
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
 
    function pause() external onlyPauser {
        _pause();
    }

    function unpause() external onlyPauser {
        _unpause();
    }

    function _authorizeUpgrade(address) internal override onlyAdmin {

    }
}
