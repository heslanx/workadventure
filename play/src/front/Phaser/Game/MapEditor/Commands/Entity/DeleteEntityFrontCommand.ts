import type { EntityDimensions, WamFile, WAMEntityData } from "@workadventure/map-editor";
import { DeleteEntityCommand } from "@workadventure/map-editor";
import type { EntitiesManager } from "../../../GameMap/EntitiesManager";
import type { FrontCommandInterface } from "../FrontCommandInterface";
import type { RoomConnection } from "../../../../../Connection/RoomConnection";
import { analyticsClient } from "../../../../../Administration/AnalyticsClient";
import { VoidFrontCommand } from "../VoidFrontCommand";
import { CreateEntityFrontCommand } from "./CreateEntityFrontCommand";

export class DeleteEntityFrontCommand extends DeleteEntityCommand implements FrontCommandInterface {
    private entityData: WAMEntityData | undefined;
    // Read before the entity is destroyed: once it is gone, the undo has nothing left to read them from.
    private entityDimensions: EntityDimensions | undefined;

    constructor(
        wamFile: WamFile,
        entityId: string,
        commandId: string | undefined,
        private entitiesManager: EntitiesManager,
    ) {
        super(wamFile, entityId, commandId);
    }

    public execute(): Promise<void> {
        const entityData = this.wamFile.getGameMapEntities().getEntity(this.entityId);
        if (!entityData) {
            throw new Error("Trying to delete a non existing Entity!");
        }
        this.entityData = structuredClone(entityData);
        const entity = this.entitiesManager.getEntities().get(this.entityId);
        this.entityDimensions = entity ? { width: entity.width, height: entity.height } : undefined;
        this.entitiesManager.deleteEntity(this.entityId);
        return super.execute();
    }

    public getUndoCommand(): CreateEntityFrontCommand | VoidFrontCommand {
        if (!this.entityData || !this.entityDimensions) {
            return new VoidFrontCommand();
        }
        return new CreateEntityFrontCommand(
            this.wamFile,
            this.entityId,
            this.entityData,
            undefined,
            this.entitiesManager,
            this.entityDimensions,
        );
    }

    public emitEvent(roomConnection: RoomConnection): void {
        roomConnection.emitMapEditorDeleteEntity(this.commandId, this.entityId);
        analyticsClient.trackAdminEvent("map_editor.entity.removed", { entityType: this.entityData?.prefabRef?.id });
    }
}
