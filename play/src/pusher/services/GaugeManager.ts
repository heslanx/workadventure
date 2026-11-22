import { Counter, Gauge } from "prom-client";

interface SubMessageTotal {
    messages: number;
    bytes: number;
}

/** A counter, by sub-message type, that copies one field of `totals` each time Prometheus scrapes it. */
function subMessageTotalsCounter(
    name: string,
    help: string,
    totals: ReadonlyMap<string, SubMessageTotal>,
    pick: (total: SubMessageTotal) => number,
): void {
    new Counter({
        name,
        help,
        labelNames: ["type"] as const,
        collect() {
            this.reset();
            for (const [type, total] of totals) {
                this.inc({ type }, pick(total));
            }
        },
    });
}

//this class should manage all the custom metrics used by prometheus
class GaugeManager {
    private nbClientsGauge: Gauge<string>;
    private nbClientsPerRoomGauge: Gauge<string>;
    private nbGroupsPerRoomGauge: Gauge<string>;
    private nbGroupsPerRoomCounter: Counter<string>;
    private nbSpacesGauge: Gauge<string>;
    private nbDroppedMovesCounter: Counter<string>;
    private nbMovingSocketsGauge: Gauge<string>;

    // What the pusher sent in batches, by sub-message type. Plain integers, because every socket adds to them about ten
    // times a second for each type it is sent: the two sub-message counters copy them when Prometheus scrapes.
    private subMessageTotals: Map<string, SubMessageTotal> = new Map();

    // Internal counters to track values per room
    private clientsPerRoom: Map<string, number> = new Map();
    private groupsPerRoom: Map<string, number> = new Map();

    constructor() {
        this.nbClientsGauge = new Gauge({
            name: "workadventure_nb_sockets",
            help: "Number of connected sockets",
            labelNames: [],
        });
        this.nbClientsPerRoomGauge = new Gauge({
            name: "workadventure_nb_clients_per_room",
            help: "Number of clients per room",
            labelNames: ["room"] as const,
        });

        this.nbGroupsPerRoomCounter = new Counter({
            name: "workadventure_counter_groups_per_room",
            help: "Counter of groups per room",
            labelNames: ["room"] as const,
        });
        this.nbGroupsPerRoomGauge = new Gauge({
            name: "workadventure_nb_groups_per_room",
            help: "Number of groups per room",
            labelNames: ["room"] as const,
        });

        this.nbSpacesGauge = new Gauge({
            name: "workadventure_nb_spaces",
            help: "Number of active spaces",
            labelNames: [],
        });

        this.nbDroppedMovesCounter = new Counter({
            name: "workadventure_counter_dropped_moves",
            help: "Counter of moves not forwarded to the back because a socket sent more than the allowed rate",
            labelNames: [],
        });

        this.nbMovingSocketsGauge = new Gauge({
            name: "workadventure_pusher_moving_sockets",
            help: "Number of sockets whose last move had moving=true",
            labelNames: [],
        });

        subMessageTotalsCounter(
            "workadventure_pusher_sub_messages_total",
            "Counter of sub-messages sent to the clients in batches, by type",
            this.subMessageTotals,
            (total) => total.messages,
        );
        subMessageTotalsCounter(
            "workadventure_pusher_sub_messages_bytes_total",
            "Counter of the bytes of the sub-messages sent to the clients in batches, by type, with the tag and length of each entry",
            this.subMessageTotals,
            (total) => total.bytes,
        );
    }

    incNbClientPerRoomGauge(roomId: string): void {
        this.nbClientsGauge.inc();
        this.nbClientsPerRoomGauge.inc({ room: roomId });

        // Track the count internally
        const currentCount = this.clientsPerRoom.get(roomId) ?? 0;
        this.clientsPerRoom.set(roomId, currentCount + 1);
    }

    decNbClientPerRoomGauge(roomId: string): void {
        this.nbClientsGauge.dec();

        // Track the count internally
        const currentCount = this.clientsPerRoom.get(roomId) ?? 0;
        const newCount = Math.max(0, currentCount - 1);

        if (newCount === 0) {
            // Remove the gauge label when it reaches 0
            this.clientsPerRoom.delete(roomId);
            this.nbClientsPerRoomGauge.remove({ room: roomId });
        } else {
            this.clientsPerRoom.set(roomId, newCount);
            this.nbClientsPerRoomGauge.dec({ room: roomId });
        }
    }

    incNbGroupsPerRoomGauge(roomId: string): void {
        this.nbGroupsPerRoomCounter.inc({ room: roomId });
        this.nbGroupsPerRoomGauge.inc({ room: roomId });

        // Track the count internally
        const currentCount = this.groupsPerRoom.get(roomId) ?? 0;
        this.groupsPerRoom.set(roomId, currentCount + 1);
    }

    decNbGroupsPerRoomGauge(roomId: string): void {
        // Track the count internally
        const currentCount = this.groupsPerRoom.get(roomId) ?? 0;
        const newCount = Math.max(0, currentCount - 1);

        if (newCount === 0) {
            // Remove the gauge label when it reaches 0
            this.groupsPerRoom.delete(roomId);
            this.nbGroupsPerRoomGauge.remove({ room: roomId });
        } else {
            this.groupsPerRoom.set(roomId, newCount);
            this.nbGroupsPerRoomGauge.dec({ room: roomId });
        }
    }

    incNbSpaces(): void {
        this.nbSpacesGauge.inc();
    }

    decNbSpaces(): void {
        this.nbSpacesGauge.dec();
    }

    incNbDroppedMoves(): void {
        this.nbDroppedMovesCounter.inc();
    }

    incNbMovingSockets(): void {
        this.nbMovingSocketsGauge.inc();
    }

    decNbMovingSockets(): void {
        this.nbMovingSocketsGauge.dec();
    }

    /** Counts one sub-message of `bytes` bytes (its entry in the batch, tag and length included) sent in a batch. */
    addSubMessage(type: string, bytes: number): void {
        this.addSubMessages(type, 1, bytes);
    }

    /** Counts `messages` sub-messages of one type, `bytes` bytes in all, sent in a batch. */
    addSubMessages(type: string, messages: number, bytes: number): void {
        let total = this.subMessageTotals.get(type);
        if (total === undefined) {
            total = { messages: 0, bytes: 0 };
            this.subMessageTotals.set(type, total);
        }
        total.messages += messages;
        total.bytes += bytes;
    }
}

export const gaugeManager = new GaugeManager();
