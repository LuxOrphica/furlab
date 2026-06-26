# Run this script in CLO 3D Python Editor (Tools > Python Editor)
# It exports the first fabric in the project as .jfab so we can inspect the structure.

import os
import fabric_api

OUTPUT_PATH = r"C:\temp\furlab_test_fabric.jfab"

# Ensure output dir exists
os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

print("[FURLAB] Script started")
count = fabric_api.GetFabricCount(True)
print(f"Fabrics in project: {count}")

if count == 0:
    print("No fabrics found. Please add a Fur or Fur_Strand material manually first,")
    print("then re-run this script.")
else:
    result = fabric_api.ExportFabric(OUTPUT_PATH, 0)
    print(f"Exported fabric 0 to: {OUTPUT_PATH}")
    print(f"Result: {result}")
    print("Open the file in a text editor to inspect the JSON structure.")
