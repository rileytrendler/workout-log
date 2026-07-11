import { db } from "../db/db";
import type { Program, ProgramEndBehavior, ProgramWeek, ProgramWorkout, ProgramWorkoutExerciseOverride, WorkoutTemplate, WorkoutTemplateExercise } from "../db/types";

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
export async function deleteProgramWeek(id:number){const week=await db.programWeeks.get(id);if(!week)return;await db.transaction("rw",db.programWeeks,db.programWorkouts,db.programWorkoutExerciseOverrides,async()=>{const workouts=await db.programWorkouts.where("programWeekId").equals(id).toArray();const ids=workouts.flatMap(w=>w.id??[]);if(ids.length)await db.programWorkoutExerciseOverrides.where("programWorkoutId").anyOf(ids).delete();await db.programWorkouts.where("programWeekId").equals(id).delete();await db.programWeeks.delete(id);await normalizeWeeks(week.programId);});}
export async function deleteProgram(id:number){await db.transaction("rw",db.programs,db.programWeeks,db.programWorkouts,db.programWorkoutExerciseOverrides,async()=>{const weeks=await db.programWeeks.where("programId").equals(id).toArray();const weekIds=weeks.flatMap(w=>w.id??[]);const workouts=weekIds.length?await db.programWorkouts.where("programWeekId").anyOf(weekIds).toArray():[];const workoutIds=workouts.flatMap(w=>w.id??[]);if(workoutIds.length)await db.programWorkoutExerciseOverrides.where("programWorkoutId").anyOf(workoutIds).delete();if(weekIds.length)await db.programWorkouts.where("programWeekId").anyOf(weekIds).delete();await db.programWeeks.where("programId").equals(id).delete();await db.programs.delete(id);});}
export async function addWorkoutToProgramWeek(weekId:number,templateId:number){if(!await db.programWeeks.get(weekId))throw new Error("Week could not be found.");if(!await db.workoutTemplates.get(templateId))throw new Error("Template could not be found.");const count=await db.programWorkouts.where("programWeekId").equals(weekId).count();const now=nowString();return db.programWorkouts.add({programWeekId:weekId,templateId,order:count+1,createdAt:now,updatedAt:now});}
export async function updateProgramWorkout(id:number,changes:{templateId:number;displayName?:string;notes?:string}){if(!await db.workoutTemplates.get(changes.templateId))throw new Error("Template could not be found.");await db.transaction("rw",db.programWorkouts,db.programWorkoutExerciseOverrides,db.workoutTemplateExercises,async()=>{await db.programWorkouts.update(id,{templateId:changes.templateId,displayName:clean(changes.displayName),notes:clean(changes.notes),updatedAt:nowString()});const valid=(await db.workoutTemplateExercises.where("templateId").equals(changes.templateId).toArray()).map(e=>e.exerciseId);const old=await db.programWorkoutExerciseOverrides.where("programWorkoutId").equals(id).toArray();await db.programWorkoutExerciseOverrides.bulkDelete(old.filter(o=>!valid.includes(o.exerciseId)).flatMap(o=>o.id??[]));});}
export async function moveProgramWorkout(id:number,direction:"up"|"down"){const current=await db.programWorkouts.get(id);if(!current)return;await db.transaction("rw",db.programWorkouts,async()=>{const rows=await db.programWorkouts.where("programWeekId").equals(current.programWeekId).sortBy("order");const i=rows.findIndex(r=>r.id===id),j=direction==="up"?i-1:i+1;if(i<0||j<0||j>=rows.length)return;await db.programWorkouts.update(id,{order:rows[j].order});await db.programWorkouts.update(rows[j].id!,{order:current.order});await normalizeWorkouts(current.programWeekId);});}
export async function removeProgramWorkout(id:number){const row=await db.programWorkouts.get(id);if(!row)return;await db.transaction("rw",db.programWorkouts,db.programWorkoutExerciseOverrides,async()=>{await db.programWorkoutExerciseOverrides.where("programWorkoutId").equals(id).delete();await db.programWorkouts.delete(id);await normalizeWorkouts(row.programWeekId);});}
export type OverrideChanges=Omit<ProgramWorkoutExerciseOverride,"id"|"programWorkoutId"|"exerciseId"|"createdAt"|"updatedAt">;
export async function upsertProgramWorkoutExerciseOverride(programWorkoutId:number,exerciseId:number,changes:OverrideChanges){const workout=await db.programWorkouts.get(programWorkoutId);if(!workout)throw new Error("Program workout could not be found.");if(!await db.workoutTemplateExercises.where("templateId").equals(workout.templateId).and(e=>e.exerciseId===exerciseId).first())throw new Error("Exercise is no longer in this template.");const existing=await db.programWorkoutExerciseOverrides.where("[programWorkoutId+exerciseId]").equals([programWorkoutId,exerciseId]).first();const now=nowString();const values={...changes,warmupInstructions:clean(changes.warmupInstructions),prescriptionNotes:clean(changes.prescriptionNotes),updatedAt:now};if(existing?.id)await db.programWorkoutExerciseOverrides.update(existing.id,values);else await db.programWorkoutExerciseOverrides.add({programWorkoutId,exerciseId,...values,createdAt:now});}
export async function clearProgramWorkoutExerciseOverride(programWorkoutId:number,exerciseId:number){await db.programWorkoutExerciseOverrides.where("[programWorkoutId+exerciseId]").equals([programWorkoutId,exerciseId]).delete();}
