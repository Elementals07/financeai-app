import BudgetManager from '../components/Budget/BudgetManager';

const BudgetPage = () => {
    return (
        <div>
            <div className="page-header">
                <div className="page-tag">Monthly Planning</div>
                <h1 className="page-title">Budget</h1>
                <p className="page-subtitle">
                    Set planned category spending limits and keep your monthly expenses on track.
                </p>
            </div>
            <BudgetManager />
        </div>
    );
};

export default BudgetPage;
