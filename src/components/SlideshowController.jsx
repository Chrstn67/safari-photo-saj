// frontend/src/components/SlideshowController.jsx
import { useState } from "react";
import { createPortal } from "react-dom";
import SlideshowDisplay from "./SlideshowDisplay.jsx";

export default function SlideshowController() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState("notation");

  const openNotationSlideshow = () => {
    setMode("notation");
    setIsOpen(true);
  };

  const openResultsSlideshow = () => {
    setMode("results");
    setIsOpen(true);
  };

  const closeSlideshow = () => {
    setIsOpen(false);
  };

  return (
    <>
      {/* Boutons pour l'admin */}
      <div className="slideshow-controller">
        <button className="btn btn-primary" onClick={openNotationSlideshow}>
          📽️ Mode Diaporama (Notation)
        </button>
        <button className="btn btn-amber" onClick={openResultsSlideshow}>
          🏆 Mode Diaporama (Résultats)
        </button>
      </div>

      {/* Affichage en plein écran via portal */}
      {isOpen &&
        createPortal(
          <SlideshowDisplay mode={mode} onExit={closeSlideshow} />,
          document.body,
        )}
    </>
  );
}
