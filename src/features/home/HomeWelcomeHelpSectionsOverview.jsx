function HomeWelcomeHelpSectionsOverview({ schema }) {
  return (
    <div className="home-help-schema" aria-label="Schema des etapes">
      {schema.map((step, index) => (
        <article key={step.title} className="home-help-step">
          <p className="home-help-step-index">Etape {index + 1}</p>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
        </article>
      ))}
    </div>
  );
}

export default HomeWelcomeHelpSectionsOverview;
