import './HomePage.css';

interface HomePageProps {
  onCreateAgreement: () => void;
  ownerName?: string;
}

export function HomePage({ onCreateAgreement, ownerName }: HomePageProps) {
  return (
    <div className="home-page">
      <div className="home-content">
        {ownerName && <p className="home-greeting">Welcome back, {ownerName}</p>}
        <h1>Cover your ass.</h1>
        <button className="btn-primary btn-large" onClick={onCreateAgreement}>
          Create Work Order
        </button>
      </div>
    </div>
  );
}
