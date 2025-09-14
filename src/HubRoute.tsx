import React from "react";
import { useNavigate } from "react-router-dom";
import RogueWheelHub from "../ui/RogueWheelHub";

export default function HubRoute() {
  const navigate = useNavigate();
  return (
    <RogueWheelHub
      onPlay={() => navigate("/game")}
      onContinue={() => navigate("/game?resume=1")}
      onNewRun={() => navigate("/game")}
      continueAvailable={true}
    />
  );
}
