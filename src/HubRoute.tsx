import React from "react";
import { useNavigate } from "react-router-dom";
import RogueWheelHub from "../ui/RogueWheelHub";

export default function HubRoute() {
  const navigate = useNavigate();
  return (
    <RogueWheelHub
      hasSave={false}
      onNew={() => navigate("/game")}
      onContinue={() => navigate("/game?resume=1")}
      onQuit={() => console.log("Quit clicked")}
      profileName="Adventurer"
      version="v0.1.0"
    />
  );
}
