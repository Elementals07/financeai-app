import { NavLink } from 'react-router-dom';
import { 
    HiOutlineHome, 
    HiOutlineCreditCard, 
    HiOutlineBanknotes,
    HiOutlineCircleStack,
    HiOutlineSparkles
} from 'react-icons/hi2';

const navItems = [
    { to: '/', end: true, icon: HiOutlineHome, label: 'Home' },
    { to: '/expenses', icon: HiOutlineCreditCard, label: 'Expenses' },
    { to: '/budget', icon: HiOutlineBanknotes, label: 'Budget' },
    { to: '/savings', icon: HiOutlineCircleStack, label: 'Savings' },
    { to: '/ai-insights', icon: HiOutlineSparkles, label: 'AI Advisor', badge: 'AI' },
];

const BottomNav = () => {
    return (
        <nav className="mobile-bottom-nav" aria-label="Mobile Navigation">
            {navItems.map((item) => {
                const Icon = item.icon;
                return (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) => 
                            `mobile-bottom-tab ${isActive ? 'active' : ''}`
                        }
                    >
                        <div className="tab-icon-wrapper">
                            <Icon className="tab-icon" aria-hidden="true" />
                            {item.badge && <span className="tab-badge">{item.badge}</span>}
                        </div>
                        <span className="tab-label">{item.label}</span>
                    </NavLink>
                );
            })}
        </nav>
    );
};

export default BottomNav;
