# Map fixture for the load run

`office.wam` and `office.tmj` are the server side of the Koncluí office map: the areas, the entities and the tile
layers that the back and map-storage read. The load bots draw nothing, so the tileset images, the entity collections
and the map scripts are left out (56 MB in the asset build).

The two files are a copy of the asset build of 2026-11-19 with one change: the two whiteboard links in `office.wam`
lost their room id and key, because a link with its key opens the whiteboard to whoever holds it.

Refresh them from the asset build when the areas or the size of the office change, and remove the room links again.
