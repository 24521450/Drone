import { Drone, Flight, Maintenance } from "./models.js";

const demoModels = ["X1 Survey", "Aero Scout", "Field Eye", "X2 Pro", "Agri Wing"];

export async function seedDemoFleet() {
  let created = 0;
  for (let index = 1; index <= 10; index += 1) {
    const droneCode = `DRONE-${String(index).padStart(3, "0")}`;
    const result = await Drone.updateOne(
      { droneCode },
      {
        $set: { isDemo: true, isArchived: false },
        $setOnInsert: {
          name: `Demo Aircraft ${String(index).padStart(2, "0")}`,
          model: demoModels[(index - 1) % demoModels.length],
          serialNumber: `DEMO-SN-${String(index).padStart(3, "0")}`,
          firmware: `1.${(index - 1) % 3}.0`,
          status: "ONLINE",
          battery: 88 + (index % 10),
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount) created += 1;
  }
  const drones = await Drone.find({ isDemo: true, isArchived: false }).sort({ droneCode: 1 }).limit(10);
  return { created, existing: 10 - created, drones };
}

export async function prepareDemoFleet() {
  const drones = await Drone.find({ isDemo: true, isArchived: false }).sort({ droneCode: 1 }).limit(10);
  if (drones.length !== 10) throw new Error("Demo fleet cannot be prepared until all 10 aircraft exist");
  const ids = drones.map((drone) => drone._id);
  const [activeFlight, activeMaintenance] = await Promise.all([
    Flight.exists({ droneId: { $in: ids }, status: "ACTIVE" }),
    Maintenance.exists({ droneId: { $in: ids }, status: "IN_PROGRESS" }),
  ]);
  if (activeFlight) throw new Error("Demo fleet cannot be prepared while a flight is active");
  if (activeMaintenance) throw new Error("Demo fleet cannot be prepared while maintenance is in progress");
  const preparedAt = new Date();
  await Drone.bulkWrite(drones.map((drone, index) => ({ updateOne: { filter: { _id: drone._id }, update: { $set: { battery: 90 + (index % 9), status: "ONLINE", lastSeen: preparedAt }, $unset: { activeFlightId: 1 } } } })));
  return { preparedAt, drones: await Drone.find({ _id: { $in: ids } }).sort({ droneCode: 1 }) };
}
