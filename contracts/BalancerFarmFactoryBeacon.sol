// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {BalancerFarmUpgradeable as Farm, IERC20, Initializable, MerkleOrchard, IVault, IAsset} from "./farms/BalancerFarmUpgradeable.sol"; 
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol"; 
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol"; 
import "./interfaces/IUnoAssetRouterBalancer.sol";

contract BalancerFarmFactoryBeacon is Initializable{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @dev Contract Variables:
     * farmBeacon - Farm contract implementation.
     *
     * distributor - Address authorized to make distributions.
     * Farms - Links {lpPools} to the deployed Farm contract.
     * lpPools - List of pools that have corresponding deployed Farm contract.
     */
    address public farmBeacon;

    address public distributor;
    mapping(address => Farm) public Farms;
    address[] public lpPools;

    IVault constant public Vault = IVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
    address constant public UnoV2Router = 0xa9877C4cbd6b4c38604ee44a11948Aa4716D5b37;

    event FarmDeployed(address indexed farmAddress);
    event Deposit(address indexed sender, address indexed lpPool, uint256 amount);
    event Withdraw(address indexed sender, address indexed lpPool, uint256 amount);
    event Distribute(address indexed lpPool);
    event DistributorChanged(address indexed newDistributor);

    modifier distributorOnly(){
        require(distributor == address(0) || msg.sender == distributor, 'The caller is not distributor');
        _;
    }

    // ============ Methods ============

    function initialize(address upgrader, address _distributor) external initializer {
        UpgradeableBeacon _farmBeacon = new UpgradeableBeacon(
            address(new Farm())
        );
        _farmBeacon.transferOwnership(upgrader);
        farmBeacon = address(_farmBeacon);
        distributor = _distributor;
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the lpPair and deposits tokens.
     * @param amounts - Amounts of tokens to deposit.
     * @param tokens - Tokens to deposit.
     * @param amountLP - Amounts of LP tokens to deposit.
     * @param lpPair - Address of the pool to deposit tokens in.
     * @param recipient - Address which will recieve the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(uint256[] memory amounts, address[] memory tokens, uint256 amountLP, address lpPair, address recipient) external returns(uint256 liquidity){
        require (amounts.length == tokens.length, "Amounts and tokens must have the same length");
        if(Farms[lpPair] == Farm(address(0))){
            Farms[lpPair] = Farm(createFarm(lpPair));
            lpPools.push(lpPair);
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            if(amounts[i] > 0){
                IERC20Upgradeable(tokens[i]).safeTransferFrom(msg.sender, address(Farms[lpPair]), amounts[i]);
            }
        }
        if(amountLP > 0){
            IERC20Upgradeable(lpPair).safeTransferFrom(msg.sender, address(Farms[lpPair]), amountLP);
        }

        liquidity = Farms[lpPair].deposit(amounts, tokens, amountLP, recipient);
        emit Deposit(recipient, lpPair, liquidity);
    }

    /** 
     * @dev Withdraws tokens from the given pool. 
     * @param lpPair - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param withdrawLP - True: Withdraw in LP tokens, False: Withdraw in normal tokens.
     * @param recipient - The address which will recieve tokens.
     */ 
    function withdraw(address lpPair, uint256 amount, bool withdrawLP, address recipient) external{ 
        require(Farms[lpPair] != Farm(address(0)), 'The given pool doesnt exist'); 
        Farms[lpPair].withdraw(msg.sender, amount, withdrawLP, recipient); 
        emit Withdraw(msg.sender, lpPair, amount);
    }

    /** 
     * @dev Performs a migration to a new Uno contract. 
     * @param lpPair - LP pool to migrate.
     */ 
    function migrate(address lpPair) external {
        require(Farms[lpPair] != Farm(address(0)), 'The given pool doesnt exist');

        uint256 amount = Farms[lpPair].userBalance(msg.sender);
        Farms[lpPair].withdraw(msg.sender, amount, true, address(this)); 

        (IERC20[] memory tokens, , ) = Vault.getPoolTokens(Farms[lpPair].poolId()); 
        uint256[] memory amounts = new uint256[](tokens.length);

        IERC20Upgradeable(lpPair).approve(UnoV2Router, amount);
        IUnoAssetRouterBalancer(UnoV2Router).deposit(lpPair, amounts, tokens, 0, amount, msg.sender); 

        emit Withdraw(msg.sender, lpPair, amount);  
    }

    function transferDistributor(address newDistributor) external distributorOnly {
        distributor = newDistributor;
        emit DistributorChanged(newDistributor);
    }

    /**
     * @dev Returns LP tokens staked by the {_address} for the given {lpPair}.
     * @param _address - The address to check stakes for.
     * @param lpPair - LP pool to check stakes in.

     * @return Total user stake(in LP tokens).
     */
    function userStake(address _address, address lpPair) external view returns(uint256){
        if(Farms[lpPair] != Farm(address(0))){
            return Farms[lpPair].userBalance(_address);
        }
        return 0;
    }    
    
    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     * @param lpPair - LP pool to check total deposits in.

     * @return Total deposits (in LP tokens).
     */ 
    function totalDeposits(address lpPair) external view returns (uint256) {
        if (Farms[lpPair] != Farm(address(0))){
            return Farms[lpPair].getTotalDeposits();
        }
        return 0;
    }

    function poolLength() external view returns (uint256){
        return lpPools.length;
    }

    /**
     * @dev Deploys new Farm contract and calls initialize on it.
     */
    function createFarm(address lpPair) internal returns (address) {
        BeaconProxy proxy = new BeaconProxy(
            farmBeacon,
            abi.encodeWithSelector(
                Farm(address(0)).initialize.selector,
                lpPair,
                address(this)
            )
        );
        emit FarmDeployed(address(proxy));
        return address(proxy);
    }
}
