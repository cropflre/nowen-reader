#!/usr/bin/env python3
import sys

with open('/Users/ultraman/Downloads/nowen-reader/internal/service/comic_parser.go', 'r') as f:
    lines = f.readlines()

# Find the warmup dispatch block by searching for the RAR check comment
start_idx = None
for i in range(650, len(lines)):
    if '检查是否为 RAR 格式' in lines[i]:
        start_idx = i
        break

if start_idx is None:
    print('ERROR: Could not find warmup dispatch block')
    sys.exit(1)

print(f'Found dispatch block at line {start_idx + 1}')

# The block to replace starts at start_idx and goes until the closing brace of the if/else
# Show what we found
for i in range(start_idx, start_idx + 11):
    print(f'  {i+1}: {lines[i]}', end='')

new_dispatch = [
    '\t\t// E-book archives in comic mode: use dedicated warmup (different extraction path)\n',
    '\t\tisEbookComic := archive.IsEbookType(archiveType)\n',
    '\n',
    '\t\tif isEbookComic {\n',
    '\t\t\twarmupEbookComic(comicID, archiveType, reader, images, startPage, end, cacheDir)\n',
    '\t\t} else if archiveType == archive.TypeRar {\n',
    '\t\t\t// 方案 C: RAR 批量解压优化\n',
    '\t\t\twarmupRarBatch(fp, comicID, images, startPage, end, cacheDir)\n',
    '\t\t} else {\n',
    '\t\t\t// ZIP/7z 等格式逐页解压（支持随机访问，性能好）\n',
    '\t\t\twarmupNormal(reader, comicID, images, startPage, end, cacheDir)\n',
    '\t\t}\n',
]

# Count old lines (from isRar check through the closing brace)
old_count = 0
for i in range(start_idx, len(lines)):
    old_count += 1
    if '}\n' == lines[i].strip() and i > start_idx + 3:
        break

lines[start_idx:start_idx + old_count] = new_dispatch

with open('/Users/ultraman/Downloads/nowen-reader/internal/service/comic_parser.go', 'w') as f:
    f.writelines(lines)

print(f'SUCCESS: Replaced {old_count} lines with {len(new_dispatch)} lines')