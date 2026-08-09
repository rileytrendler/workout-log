import type { Exercise, WorkoutSet } from "../db/types";
import { formatSetPerformance } from "./setFormatting";
import { getTotalExternalLoad, parseLoadExpression } from "./loadFormatting";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(`Load formatting fixture failed: ${message}`);
}

function value(expression: string) {
  const result = parseLoadExpression(expression);
  if (!result.valid) throw new Error(result.error);
  return result.value;
}

export function runLoadFormattingFixtures() {
  assert(value("7x45+25") === 340, "7x45+25 should equal 340");
  assert(value("45x5+10") === 235, "45x5+10 should equal 235");
  assert(value("2x45+12.5") === 102.5, "decimals should parse");
  assert(!parseLoadExpression("7xx45").valid, "double multiplication should be rejected");
  assert(!parseLoadExpression("7x45+").valid, "trailing addition should be rejected");

  const paired: Exercise = { name: "DB Press", defaultUnit: "lb", measurementType: "weight_reps",
    loadEntryMode: "paired", createdAt: "fixture" };
  const pairedSet: WorkoutSet = { workoutExerciseId: 1, setNumber: 1, weight: 90, reps: 9, failedOnRep: 10 };
  assert(pairedSet.weight === 90, "paired comparison weight should remain 90");
  assert(getTotalExternalLoad(paired, pairedSet) === 180, "paired total external load should be 180");
  assert(formatSetPerformance(pairedSet, "weight_reps", paired) === "90 lb each × 10f",
    "paired failed-set formatting should include each and attempted rep");

  const expression: Exercise = { ...paired, name: "Leg Press", loadEntryMode: "expression" };
  const expressionSet: WorkoutSet = { ...pairedSet, weight: 340, reps: 10, failedOnRep: 11, loadExpression: "7x45+25" };
  assert(expressionSet.weight === 340, "expression comparison weight should remain numeric total");
  assert(formatSetPerformance(expressionSet, "weight_reps", expression) === "7x45+25 (340 lb) × 11f",
    "expression failed-set formatting should preserve expression and numeric total");
  console.info("Load formatting fixtures passed (10 scenarios).");
}

runLoadFormattingFixtures();
