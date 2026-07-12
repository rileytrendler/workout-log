import { db } from "../db/db";
import type { ActiveProgramState, Program, ProgramEndBehavior, ProgramWeek, ProgramWorkout, ProgramWorkoutExerciseOverride, Workout, WorkoutExercise, WorkoutTemplate, WorkoutTemplateExercise } from "../db/types";

const nowString = () => new Date().toISOString();
const clean = (value?: string) => value?.trim() || undefined;

export type ProgramEditorData = {
  program: Program;
  weeks: Array<ProgramWeek & { workouts: Array<ProgramWorkout & { template?: WorkoutTemplate; templateExercises: WorkoutTemplateExercise[]; overrides: ProgramWorkoutExerciseOverride[] }> }>;
};

export async function getPrograms() {
  return db.programs.orderBy("name").toArray();
}

export async function createProgram(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Program name is required.");
  if (await db.programs.where("name").equalsIgnoreCase(trimmed).first()) throw new Error("A program with that name already exists.");
  const now = nowString();
  return db.programs.add({ name: trimmed, endBehavior: "stop", createdAt: now, updatedAt: now });
}

export async function updateProgram(id: number, changes: { name: string; notes?: string; endBehavior: ProgramEndBehavior }) {
  const name = changes.name.trim();
  if (!name) throw new Error("Program name is required.");
  const duplicate = await db.programs.where("name").equalsIgnoreCase(name).first();
  if (duplicate?.id !== id) throw new Error("A program with that name already exists.");
  await db.programs.update(id, { name, notes: clean(changes.notes), endBehavior: changes.endBehavior, updatedAt: nowString() });
}

export async function getProgramEditorData(programId: number): Promise<ProgramEditorData | null> {
  const program = await db.programs.get(programId);
  if (!program) return null;
  const weeks = await db.programWeeks.where("programId").equals(programId).sortBy("order");
  const workouts = weeks.length ? await db.programWorkouts.where("programWeekId").anyOf(weeks.flatMap(w => w.id ?? [])).toArray() : [];
  const templates = await db.workoutTemplates.bulkGet(workouts.map(w => w.templateId));
  const workoutIds = workouts.flatMap(w => w.id ?? []);
  const overrides = workoutIds.length ? await db.programWorkoutExerciseOverrides.where("programWorkoutId").anyOf(workoutIds).toArray() : [];
  const templateIds = [...new Set(workouts.map(w => w.templateId))];
  const templateExercises = templateIds.length ? await db.workoutTemplateExercises.where("templateId").anyOf(templateIds).toArray() : [];
  return { program, weeks: weeks.map(week => ({ ...week, workouts: workouts.filter(w => w.programWeekId === week.id).sort((a,b) => a.order-b.order).map(workout => ({ ...workout, template: templates[workouts.indexOf(workout)], templateExercises: templateExercises.filter(e => e.templateId === workout.templateId).sort((a,b) => a.order-b.order), overrides: overrides.filter(o => o.programWorkoutId === workout.id) })) })) };
}

async function normalizeWeeks(programId: number) {
  const rows = await db.programWeeks.where("programId").equals(programId).sortBy("order");
  await Promise.all(rows.map((row, i) => row.id && db.programWeeks.update(row.id, { order: i + 1, updatedAt: nowString() })));
}
async function normalizeWorkouts(weekId: number) {
  const rows = await db.programWorkouts.where("programWeekId").equals(weekId).sortBy("order");
  await Promise.all(rows.map((row, i) => row.id && db.programWorkouts.update(row.id, { order: i + 1, updatedAt: nowString() })));
}

export async function addProgramWeek(programId: number) {
  if (!await db.programs.get(programId)) throw new Error("Program could not be found.");
  const count = await db.programWeeks.where("programId").equals(programId).count(); const now = nowString();
  return db.programWeeks.add({ programId, order: count + 1, createdAt: now, updatedAt: now });
}
export async function updateProgramWeek(id: number, changes: { name?: string; notes?: string }) { await db.programWeeks.update(id, { name: clean(changes.name), notes: clean(changes.notes), updatedAt: nowString() }); }
export async function moveProgramWeek(id: number, direction: "up"|"down") {
  const current = await db.programWeeks.get(id); if (!current) return;
  await db.transaction("rw", db.programWeeks, async () => { const rows = await db.programWeeks.where("programId").equals(current.programId).sortBy("order"); const i = rows.findIndex(r=>r.id===id); const j=direction==="up"?i-1:i+1; if(i<0||j<0||j>=rows.length)return; await db.programWeeks.update(id,{order:rows[j].order}); await db.programWeeks.update(rows[j].id!,{order:current.order}); await normalizeWeeks(current.programId); });
}
export async function duplicateProgramWeek(id: number) {
  const source=await db.programWeeks.get(id); if(!source) throw new Error("Week could not be found.");
  await db.transaction("rw", db.programWeeks, db.programWorkouts, db.programWorkoutExerciseOverrides, async()=>{ const now=nowString(); const weeks=await db.programWeeks.where("programId").equals(source.programId).sortBy("order"); await Promise.all(weeks.filter(w=>w.order>source.order).map(w=>db.programWeeks.update(w.id!,{order:w.order+1}))); const newWeekId=await db.programWeeks.add({...source,id:undefined,order:source.order+1,name:source.name?`${source.name} Copy`:undefined,createdAt:now,updatedAt:now}); const workouts=await db.programWorkouts.where("programWeekId").equals(id).sortBy("order"); for(const workout of workouts){const newWorkoutId=await db.programWorkouts.add({...workout,id:undefined,programWeekId:newWeekId,createdAt:now,updatedAt:now}); if(workout.id){const overrides=await db.programWorkoutExerciseOverrides.where("programWorkoutId").equals(workout.id).toArray(); await db.programWorkoutExerciseOverrides.bulkAdd(overrides.map(o=>({...o,id:undefined,programWorkoutId:newWorkoutId,createdAt:now,updatedAt:now})));}} });
}
export async function deleteProgramWeek(id:number){const week=await db.programWeeks.get(id);if(!week)return;await db.transaction("rw",db.programWeeks,db.programWorkouts,db.programWorkoutExerciseOverrides,db.activeProgramStates,async()=>{if((await getActiveProgramState())?.currentProgramWeekId===id)throw new Error("Move Program progress away from this week before deleting it.");const workouts=await db.programWorkouts.where("programWeekId").equals(id).toArray();const ids=workouts.flatMap(w=>w.id??[]);if(ids.length)await db.programWorkoutExerciseOverrides.where("programWorkoutId").anyOf(ids).delete();await db.programWorkouts.where("programWeekId").equals(id).delete();await db.programWeeks.delete(id);await normalizeWeeks(week.programId);});}
export async function deleteProgram(id:number){await db.transaction("rw",db.programs,db.programWeeks,db.programWorkouts,db.programWorkoutExerciseOverrides,db.activeProgramStates,async()=>{if(await db.activeProgramStates.where("programId").equals(id).count())throw new Error("Deactivate this program before deleting it.");const weeks=await db.programWeeks.where("programId").equals(id).toArray();const weekIds=weeks.flatMap(w=>w.id??[]);const workouts=weekIds.length?await db.programWorkouts.where("programWeekId").anyOf(weekIds).toArray():[];const workoutIds=workouts.flatMap(w=>w.id??[]);if(workoutIds.length)await db.programWorkoutExerciseOverrides.where("programWorkoutId").anyOf(workoutIds).delete();if(weekIds.length)await db.programWorkouts.where("programWeekId").anyOf(weekIds).delete();await db.programWeeks.where("programId").equals(id).delete();await db.programs.delete(id);});}
export async function addWorkoutToProgramWeek(weekId:number,templateId:number){if(!await db.programWeeks.get(weekId))throw new Error("Week could not be found.");if(!await db.workoutTemplates.get(templateId))throw new Error("Template could not be found.");const count=await db.programWorkouts.where("programWeekId").equals(weekId).count();const now=nowString();return db.programWorkouts.add({programWeekId:weekId,templateId,order:count+1,createdAt:now,updatedAt:now});}
export async function updateProgramWorkout(id:number,changes:{templateId:number;displayName?:string;notes?:string}){if(!await db.workoutTemplates.get(changes.templateId))throw new Error("Template could not be found.");await db.transaction("rw",db.programWorkouts,db.programWorkoutExerciseOverrides,db.workoutTemplateExercises,async()=>{await db.programWorkouts.update(id,{templateId:changes.templateId,displayName:clean(changes.displayName),notes:clean(changes.notes),updatedAt:nowString()});const valid=(await db.workoutTemplateExercises.where("templateId").equals(changes.templateId).toArray()).map(e=>e.exerciseId);const old=await db.programWorkoutExerciseOverrides.where("programWorkoutId").equals(id).toArray();await db.programWorkoutExerciseOverrides.bulkDelete(old.filter(o=>!valid.includes(o.exerciseId)).flatMap(o=>o.id??[]));});}
export async function moveProgramWorkout(id:number,direction:"up"|"down"){const current=await db.programWorkouts.get(id);if(!current)return;await db.transaction("rw",db.programWorkouts,async()=>{const rows=await db.programWorkouts.where("programWeekId").equals(current.programWeekId).sortBy("order");const i=rows.findIndex(r=>r.id===id),j=direction==="up"?i-1:i+1;if(i<0||j<0||j>=rows.length)return;await db.programWorkouts.update(id,{order:rows[j].order});await db.programWorkouts.update(rows[j].id!,{order:current.order});await normalizeWorkouts(current.programWeekId);});}
export async function removeProgramWorkout(id:number){const row=await db.programWorkouts.get(id);if(!row)return;await db.transaction("rw",db.programWorkouts,db.programWorkoutExerciseOverrides,db.activeProgramStates,async()=>{if((await getActiveProgramState())?.currentProgramWorkoutId===id)throw new Error("Move Program progress away from this workout before removing it.");await db.programWorkoutExerciseOverrides.where("programWorkoutId").equals(id).delete();await db.programWorkouts.delete(id);await normalizeWorkouts(row.programWeekId);});}
export type OverrideChanges=Omit<ProgramWorkoutExerciseOverride,"id"|"programWorkoutId"|"exerciseId"|"createdAt"|"updatedAt">;
export async function upsertProgramWorkoutExerciseOverride(programWorkoutId:number,exerciseId:number,changes:OverrideChanges){const workout=await db.programWorkouts.get(programWorkoutId);if(!workout)throw new Error("Program workout could not be found.");if(!await db.workoutTemplateExercises.where("templateId").equals(workout.templateId).and(e=>e.exerciseId===exerciseId).first())throw new Error("Exercise is no longer in this template.");const existing=await db.programWorkoutExerciseOverrides.where("[programWorkoutId+exerciseId]").equals([programWorkoutId,exerciseId]).first();const now=nowString();const values={...changes,warmupInstructions:clean(changes.warmupInstructions),prescriptionNotes:clean(changes.prescriptionNotes),updatedAt:now};if(existing?.id)await db.programWorkoutExerciseOverrides.update(existing.id,values);else await db.programWorkoutExerciseOverrides.add({programWorkoutId,exerciseId,...values,createdAt:now});}
export async function clearProgramWorkoutExerciseOverride(programWorkoutId:number,exerciseId:number){await db.programWorkoutExerciseOverrides.where("[programWorkoutId+exerciseId]").equals([programWorkoutId,exerciseId]).delete();}

export type PlannedProgramWorkout = {
  state: ActiveProgramState;
  program: Program;
  week: ProgramWeek;
  workout: ProgramWorkout;
  template: WorkoutTemplate;
  workoutIndex: number;
  workoutCount: number;
};

async function orderedSlots(programId: number) {
  const weeks = await db.programWeeks.where("programId").equals(programId).sortBy("order");
  const result: Array<{ week: ProgramWeek; workout: ProgramWorkout }> = [];
  for (const week of weeks) {
    if (!week.id) continue;
    const workouts = await db.programWorkouts.where("programWeekId").equals(week.id).sortBy("order");
    result.push(...workouts.map(workout => ({ week, workout })));
  }
  return result;
}

export async function getActiveProgramState() { return db.activeProgramStates.toCollection().first(); }

export async function getPlannedProgramWorkout(): Promise<PlannedProgramWorkout | null> {
  const state = await getActiveProgramState();
  if (!state) return null;
  const [program, week, workout] = await Promise.all([db.programs.get(state.programId), db.programWeeks.get(state.currentProgramWeekId), db.programWorkouts.get(state.currentProgramWorkoutId)]);
  if (!program || !week || !workout || week.programId !== program.id || workout.programWeekId !== week.id) return null;
  const template = await db.workoutTemplates.get(workout.templateId);
  if (!template) return null;
  const weekWorkouts = await db.programWorkouts.where("programWeekId").equals(week.id!).sortBy("order");
  return { state, program, week, workout, template, workoutIndex: weekWorkouts.findIndex(row => row.id === workout.id) + 1, workoutCount: weekWorkouts.length };
}

export async function activateProgram(programId: number, replace = false): Promise<void> {
  await db.transaction("rw", db.programs, db.programWeeks, db.programWorkouts, db.activeProgramStates, db.workouts, async () => {
    const existing = await getActiveProgramState();
    if (existing && !replace) throw new Error("Another program is active. Deactivate it or explicitly replace it first.");
    if (existing && replace) {
      const activeWorkout = await db.workouts.where("status").equals("active").first();
      if (activeWorkout?.programId === existing.programId) throw new Error("Finish the active Program workout before replacing its Program.");
    }
    const program = await db.programs.get(programId);
    if (!program) throw new Error("Program could not be found.");
    const slots = await orderedSlots(programId);
    const first = slots[0];
    if (!first?.week.id || !first.workout.id) throw new Error("Add at least one workout slot to this program before activating it.");
    const now = nowString();
    await db.activeProgramStates.clear();
    await db.activeProgramStates.add({ programId, currentProgramWeekId: first.week.id, currentProgramWorkoutId: first.workout.id, activatedAt: now, updatedAt: now });
  });
}

export async function deactivateProgram(): Promise<void> {
  await db.transaction("rw", db.activeProgramStates, db.workouts, async () => {
    const state = await getActiveProgramState();
    if (!state) return;
    const active = await db.workouts.where("status").equals("active").first();
    if (active?.programId === state.programId) throw new Error("Finish or delete the active Program workout before deactivating this program.");
    await db.activeProgramStates.clear();
  });
}

export async function advanceActiveProgram(expected?: { programId: number; weekId: number; workoutId: number }): Promise<"advanced" | "completed" | "mismatch"> {
  const state = await getActiveProgramState();
  if (!state) return "mismatch";
  if (expected && (state.programId !== expected.programId || state.currentProgramWeekId !== expected.weekId || state.currentProgramWorkoutId !== expected.workoutId)) return "mismatch";
  const program = await db.programs.get(state.programId);
  if (!program) return "mismatch";
  const slots = await orderedSlots(program.id!);
  const index = slots.findIndex(slot => slot.week.id === state.currentProgramWeekId && slot.workout.id === state.currentProgramWorkoutId);
  if (index < 0) return "mismatch";
  let next: { week: ProgramWeek; workout: ProgramWorkout } | undefined = slots[index + 1];
  if (!next) {
    if (program.endBehavior === "stop") { await db.activeProgramStates.clear(); return "completed"; }
    if (program.endBehavior === "repeat") next = slots[0];
    else {
      const finalWeekId = slots.at(-1)?.week.id;
      next = slots.find(slot => slot.week.id === finalWeekId);
    }
  }
  if (!next?.week.id || !next.workout.id) return "mismatch";
  await db.activeProgramStates.update(state.id!, { currentProgramWeekId: next.week.id, currentProgramWorkoutId: next.workout.id, updatedAt: nowString() });
  return "advanced";
}

export async function skipPlannedWorkout() {
  return db.transaction("rw", db.activeProgramStates, db.programs, db.programWeeks, db.programWorkouts, async () => advanceActiveProgram());
}

export async function moveActiveProgramProgress(direction: "previous" | "next", weekId?: number, workoutId?: number): Promise<void> {
  await db.transaction("rw", db.activeProgramStates, db.programWeeks, db.programWorkouts, db.workouts, async () => {
    const state = await getActiveProgramState(); if (!state) throw new Error("No program is active.");
    const active = await db.workouts.where("status").equals("active").first();
    if (active?.programId === state.programId) throw new Error("Finish the active Program workout before changing Program progress.");
    const slots = await orderedSlots(state.programId);
    const current = slots.findIndex(s => s.week.id === state.currentProgramWeekId && s.workout.id === state.currentProgramWorkoutId);
    const target = weekId && workoutId ? slots.find(s => s.week.id === weekId && s.workout.id === workoutId) : slots[current + (direction === "next" ? 1 : -1)];
    if (!target?.week.id || !target.workout.id) throw new Error(`There is no ${direction} planned workout.`);
    await db.activeProgramStates.update(state.id!, { currentProgramWeekId: target.week.id, currentProgramWorkoutId: target.workout.id, updatedAt: nowString() });
  });
}

export async function startPlannedProgramWorkout(date: string, gymId?: number): Promise<Workout> {
  return db.transaction("rw", [db.activeProgramStates, db.programs, db.programWeeks, db.programWorkouts, db.programWorkoutExerciseOverrides, db.workoutTemplates, db.workoutTemplateExercises, db.workouts, db.workoutExercises], async () => {
    if (await db.workouts.where("status").equals("active").first()) throw new Error("A workout is already active. Finish it before starting the planned workout.");
    const planned = await getPlannedProgramWorkout();
    if (!planned) throw new Error("The planned Program workout is no longer valid. Review the active Program.");
    const templateExercises = await db.workoutTemplateExercises.where("templateId").equals(planned.template.id!).sortBy("order");
    if (!templateExercises.length) throw new Error(`“${planned.template.name}” is empty. Add at least one exercise before starting it.`);
    const overrides = await db.programWorkoutExerciseOverrides.where("programWorkoutId").equals(planned.workout.id!).toArray();
    const validIds = new Set(templateExercises.map(row => row.exerciseId));
    if (overrides.some(row => !validIds.has(row.exerciseId))) throw new Error("A Program override references an exercise that is no longer in the template.");
    const overrideByExercise = new Map(overrides.map(row => [row.exerciseId, row]));
    const now = nowString();
    const weekLabel = planned.week.name?.trim() || `Week ${planned.week.order}`;
    const workoutName = planned.workout.displayName?.trim() || planned.template.name;
    const notes = [planned.template.notes?.trim(), planned.workout.notes?.trim()].filter(Boolean).join("\n\n") || undefined;
    const workoutId = await db.workouts.add({ date, status: "active", gymId, title: workoutName, notes, startTime: now, createdAt: now, updatedAt: now, programId: planned.program.id, programWeekId: planned.week.id, programWorkoutId: planned.workout.id, programNameSnapshot: planned.program.name, programWeekLabelSnapshot: weekLabel, programWorkoutNameSnapshot: workoutName });
    const fields = ["plannedSetCount","targetMinReps","targetMaxReps","targetRpeMin","targetRpeMax","targetRestSeconds","warmupInstructions","prescriptionNotes"] as const;
    const rows: WorkoutExercise[] = templateExercises.map((templateExercise, index) => {
      const override = overrideByExercise.get(templateExercise.exerciseId);
      const resolved: Partial<WorkoutExercise> = {};
      for (const field of fields) resolved[field] = override?.[field] !== undefined ? override[field] as never : templateExercise[field] as never;
      resolved.plannedLastSetIntensityTechnique = override?.plannedLastSetIntensityTechnique !== undefined
        ? override.plannedLastSetIntensityTechnique ?? undefined
        : templateExercise.plannedLastSetIntensityTechnique;
      return { workoutId, exerciseId: templateExercise.exerciseId, order: index + 1, ...resolved, startedAt: now, createdAt: now, updatedAt: now };
    });
    await db.workoutExercises.bulkAdd(rows);
    const created = await db.workouts.get(workoutId); if (!created) throw new Error("Workout could not be created."); return created;
  });
}
