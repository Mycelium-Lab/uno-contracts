// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {IUnoFarmBalancer as Farm} from '../apps/balancer/interfaces/IUnoFarmBalancer.sol'; 
import '../interfaces/IUnoFarmFactory.sol';
import '../interfaces/IUnoAccessManager.sol'; 
import '../interfaces/IVault.sol'; 
import "../interfaces/IBasePool.sol";
import '../interfaces/IWMATIC.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';

contract UnoAssetRouterBalancerV2 is Initializable, PausableUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @dev Contract Variables:
     * farmFactory - The contract that deploys new Farms and links them to {lpPool}s.
     * accessManager - Role manager contract.
     */
    IUnoFarmFactory public farmFactory;
    IUnoAccessManager public accessManager;

    bytes32 private constant DISTRIBUTOR_ROLE = keccak256('DISTRIBUTOR_ROLE');
    bytes32 private constant PAUSER_ROLE = keccak256('PAUSER_ROLE');

    IVault constant private Vault = IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);

    uint256 public fee;

    address public constant WMATIC = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;

    uint256 public constant version = 2;

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

    function initialize(address _accessManager, address _farmFactory) external initializer{
        require (_accessManager != address(0), 'BAD_ACCESS_MANAGER');
        require (_farmFactory != address(0), 'BAD_FARM_FACTORY');

        __Pausable_init();
        accessManager = IUnoAccessManager(_accessManager);
        farmFactory = IUnoFarmFactory(_farmFactory);
    }

    receive() external payable {
        require(msg.sender == WMATIC, 'ONLY_ACCEPT_WMATIC'); // only accept ETH via fallback from the WMATIC contract
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool} and deposits tokens in it.
     * @param lpPool - Address of the pool to deposit tokens in.
     * @param amounts - Amounts of tokens to deposit.
     * @param tokens - Tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {{tokens}} deposit.
     * @param amountLP - Additional amount of LP tokens to deposit.
     * @param recipient - Address which will receive the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(address lpPool, uint256[] memory amounts, address[] memory tokens, uint256 minAmountLP, uint256 amountLP, address recipient) external whenNotPaused returns(uint256 liquidity){
        require (amounts.length == tokens.length, 'AMOUNTS_AND_TOKENS_LENGTHS_NOT_MATCH');
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPool));
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            if(amounts[i] > 0){
                IERC20Upgradeable(tokens[i]).safeTransferFrom(msg.sender, address(farm), amounts[i]);
            }
        }
        if(amountLP > 0){
            IERC20Upgradeable(lpPool).safeTransferFrom(msg.sender, address(farm), amountLP);
        }
        
        liquidity = farm.deposit(amounts, tokens, minAmountLP, amountLP, recipient);
        emit Deposit(lpPool, msg.sender, recipient, liquidity); 
    }

        /**
     * @dev Autoconverts MATIC into WMATIC and deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool} and deposits tokens in it.
     * @param lpPool - Address of the pool to deposit tokens in.
     * @param amounts - Amounts of tokens to deposit.
     * @param tokens - Tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {{tokens}} deposit.
     * @param amountLP - Additional amount of LP tokens to deposit.
     * @param recipient - Address which will receive the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function depositETH(address lpPool, uint256[] memory amounts, address[] memory tokens, uint256 minAmountLP, uint256 amountLP, address recipient) external payable whenNotPaused returns(uint256 liquidity){
        require(msg.value > 0, "NO_MATIC_SENT");
        require (amounts.length == tokens.length, 'AMOUNTS_AND_TOKENS_LENGTHS_NOT_MATCH');

        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPool));
        }

        bool WMaticInTokens = false;
        for (uint256 i = 0; i < tokens.length; i++) {
            if(tokens[i] == WMATIC){
                WMaticInTokens = true;
                amounts[i] = msg.value;
                break;
            }
        }
        require(WMaticInTokens, "NO_WMATIC_IN_TOKENS");

        IWMATIC(WMATIC).deposit{value: msg.value}();
        IERC20Upgradeable(WMATIC).safeTransfer(address(farm), msg.value);
        for (uint256 i = 0; i < tokens.length; i++) {
            if(amounts[i] > 0 && tokens[i] != WMATIC){
                IERC20Upgradeable(tokens[i]).safeTransferFrom(msg.sender, address(farm), amounts[i]);
            }
        }
        if(amountLP > 0){
            IERC20Upgradeable(lpPool).safeTransferFrom(msg.sender, address(farm), amountLP);
        }
        
        liquidity = farm.deposit(amounts, tokens, minAmountLP, amountLP, recipient);
        emit Deposit(lpPool, msg.sender, recipient, liquidity); 
    }

    /** 
     * @dev Withdraws tokens from the given pool. 
     * @param lpPool - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param minAmountsOut - Minimum token amounts the user will receive.
     * @param withdrawLP - True: Withdraw in LP tokens, False: Withdraw in normal tokens.
     * @param recipient - The address which will receive tokens.

     * @return amounts - Token amounts sent to the {recipient}
     */ 
    function withdraw(address lpPool, uint256 amount, uint256[] calldata minAmountsOut, bool withdrawLP, address recipient) external returns(uint256[] memory amounts){ 
        Farm farm = Farm(farmFactory.Farms(lpPool));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');

        amounts = farm.withdraw(amount, minAmountsOut, withdrawLP, msg.sender, recipient);
        emit Withdraw(lpPool, msg.sender, recipient, amount);  
    }

    /** 
     * @dev Autoconverts WMATIC into MATIC and withdraws tokens from the given pool. 
     * @param lpPool - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param minAmountsOut - Minimum token amounts the user will receive.
     * @param recipient - The address which will receive tokens.

     * @return amounts - Token amounts sent to the {recipient}
     */ 
    function withdrawETH(address lpPool, uint256 amount, uint256[] calldata minAmountsOut, address recipient) external returns(uint256[] memory amounts){ 
        Farm farm = Farm(farmFactory.Farms(lpPool));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');

        amounts = farm.withdraw(amount, minAmountsOut, false, msg.sender, address(this));

        IERC20[] memory tokens = getTokens(lpPool);
        for (uint256 i = 0; i < tokens.length; i++) {
            if (address(tokens[i]) != WMATIC) {
                IERC20Upgradeable(address(tokens[i])).safeTransfer(recipient, amounts[i]);
                continue;
            }
            IWMATIC(WMATIC).withdraw(amounts[i]);
            payable(recipient).transfer(amounts[i]);
        } 
        emit Withdraw(lpPool, msg.sender, recipient, amount);  
    }

    /**
     * @dev Distributes tokens between users for a single {Farms[lpPool]}.
     * @param lpPool - The pool to distribute. 
     * @param swapInfos - The data used to swap reward tokens for the needed tokens.
     * @param feeSwapInfos - The data used to swap reward tokens for fees.
     * @param feeTo - Address to collect fees to.
     *
     * Note: This function can only be called by the distributor.
     */
    function distribute(
        address lpPool,
        Farm.SwapInfo[] calldata swapInfos,
        Farm.SwapInfo[] calldata feeSwapInfos,
        address feeTo
    ) external whenNotPaused onlyRole(DISTRIBUTOR_ROLE) {
        Farm farm = Farm(farmFactory.Farms(lpPool));
        require(farm != Farm(address(0)), 'FARM_NOT_EXISTS');

        uint256 reward = farm.distribute(swapInfos, feeSwapInfos, Farm.FeeInfo(feeTo, fee));
        emit Distribute(lpPool, reward);
    }

    /**
     * @dev Returns LP tokens staked by the {_address} for the given {lpPool}.
     * @param _address - The address to check stakes for.
     * @param lpPool - LP pool to check stakes in.

     * @return Total user stake(in LP tokens).
     */
   function userStake(address _address, address lpPool) external view returns(uint256){
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if (farm != Farm(address(0))) {
            return farm.userBalance(_address);
        }
        return 0;
    }

    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     * @param lpPool - LP pool to check total deposits in.

     * @return Total deposits (in LP tokens).
     */
    function totalDeposits(address lpPool) external view returns (uint256) {
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if (farm != Farm(address(0))) {
            return farm.getTotalDeposits();
        }
        return 0;
    }

    /**
     * @dev Returns addresses of tokens in {lpPool}.
     * @param lpPool - LP pool to check tokens in.

     * @return tokens - Token addresses.
     */  
    function getTokens(address lpPool) public view returns(IERC20[] memory tokens){
        bytes32 poolId = IBasePool(lpPool).getPoolId();
        (tokens, , ) = Vault.getPoolTokens(poolId);
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

    function _authorizeUpgrade(address) internal override onlyRole(accessManager.ADMIN_ROLE()) {

    }
}
