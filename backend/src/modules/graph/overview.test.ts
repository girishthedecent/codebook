import { describe, expect, it } from 'vitest';
import { countPackageCalls, importedNames, packageOf } from './overview.js';

describe('packageOf', () => {
  it('names the package of a JavaScript module path', () => {
    expect(packageOf('express', 'src/a.ts')).toBe('express');
    expect(packageOf('lodash/merge', 'src/a.ts')).toBe('lodash');
    expect(packageOf('@aws-sdk/client-s3', 'src/a.ts')).toBe('@aws-sdk/client-s3');
    expect(packageOf('@aws-sdk/client-s3/commands', 'src/a.ts')).toBe('@aws-sdk/client-s3');
    expect(packageOf('node:fs/promises', 'src/a.ts')).toBe('node:fs');
  });

  it('names the package of a Python module', () => {
    expect(packageOf('torch.nn.functional', 'model.py')).toBe('torch');
    expect(packageOf('math', 'model.py')).toBe('math');
  });
});

describe('importedNames', () => {
  it('reads what Python imports bind, aliases and lists included', () => {
    const text = [
      'import math',
      'import torch.nn as nn',
      'import os, sys as system',
      'from torch.nn import functional as F',
      'from dataclasses import dataclass, field',
      'from contextlib import (',
      '    nullcontext,',
      '    suppress as quiet,',
      ')',
      '    import indented_is_not_top_level',
    ].join('\n');

    expect(importedNames(text, true)).toEqual([
      { local: 'math', specifier: 'math' },
      { local: 'nn', specifier: 'torch.nn' },
      { local: 'os', specifier: 'os' },
      { local: 'system', specifier: 'sys' },
      { local: 'F', specifier: 'torch.nn' },
      { local: 'dataclass', specifier: 'dataclasses' },
      { local: 'field', specifier: 'dataclasses' },
      { local: 'nullcontext', specifier: 'contextlib' },
      { local: 'quiet', specifier: 'contextlib' },
    ]);
  });

  it('binds the first part of a dotted Python import without an alias', () => {
    expect(importedNames('import os.path', true)).toEqual([{ local: 'os', specifier: 'os.path' }]);
  });

  it('reads what ES imports and require() bind', () => {
    const text = [
      "import express from 'express';",
      "import * as path from 'node:path';",
      "import React, { useState, useEffect as onMount } from 'react';",
      "import type { Request } from 'express';",
      'import {',
      '  Pool,',
      '  type PoolClient,',
      "} from 'pg';",
      "import './side-effect.js';",
      "const fs = require('fs');",
      "const { z, ZodError: Oops } = require('zod');",
    ].join('\n');

    expect(importedNames(text, false)).toEqual([
      { local: 'express', specifier: 'express' },
      { local: 'path', specifier: 'node:path' },
      { local: 'React', specifier: 'react' },
      { local: 'useState', specifier: 'react' },
      { local: 'onMount', specifier: 'react' },
      { local: 'Request', specifier: 'express' },
      { local: 'Pool', specifier: 'pg' },
      { local: 'PoolClient', specifier: 'pg' },
      { local: 'fs', specifier: 'fs' },
      { local: 'z', specifier: 'zod' },
      { local: 'Oops', specifier: 'zod' },
    ]);
  });
});

describe('countPackageCalls', () => {
  const external = [
    { filePath: 'model.py', specifier: 'math' },
    { filePath: 'model.py', specifier: 'torch' },
    { filePath: 'model.py', specifier: 'torch.nn' },
    { filePath: 'train.py', specifier: 'numpy' },
    { filePath: 'server.ts', specifier: 'pg' },
    { filePath: 'server.ts', specifier: '@aws-sdk/client-s3' },
  ];
  const heads = new Map([
    [
      'model.py',
      'import math\nimport torch\nimport torch.nn as nn\nfrom torch.nn import functional as F\nfrom model import GPT\n',
    ],
    ['train.py', 'import numpy as np\n'],
    [
      'server.ts',
      "import { Pool } from 'pg';\nimport { S3Client } from '@aws-sdk/client-s3';\nimport { local } from './local.js';\n",
    ],
  ]);

  it('counts calls for the package whose import binds the name they start with', () => {
    const calls = [
      { filePath: 'model.py', head: 'math', calls: 2 },
      { filePath: 'model.py', head: 'torch', calls: 3 },
      { filePath: 'model.py', head: 'nn', calls: 5 },
      { filePath: 'model.py', head: 'F', calls: 4 },
      { filePath: 'train.py', head: 'np', calls: 6 },
      { filePath: 'server.ts', head: 'Pool', calls: 1 },
      { filePath: 'server.ts', head: 'S3Client', calls: 2 },
    ];

    expect(countPackageCalls(calls, external, heads, 10)).toEqual([
      { name: 'torch', calls: 12 },
      { name: 'numpy', calls: 6 },
      { name: '@aws-sdk/client-s3', calls: 2 },
      { name: 'math', calls: 2 },
      { name: 'pg', calls: 1 },
    ]);
  });

  it('leaves out calls no import explains, and an import of an in-repository module', () => {
    const calls = [
      { filePath: 'model.py', head: 'print', calls: 9 },
      { filePath: 'model.py', head: 'self', calls: 9 },
      { filePath: 'model.py', head: 'GPT', calls: 4 },
      { filePath: 'server.ts', head: 'local', calls: 3 },
      // `np` is bound in train.py only.
      { filePath: 'model.py', head: 'np', calls: 3 },
    ];

    expect(countPackageCalls(calls, external, heads, 10)).toEqual([]);
  });

  it('keeps the most called packages, ties by name', () => {
    const calls = [
      { filePath: 'model.py', head: 'math', calls: 2 },
      { filePath: 'train.py', head: 'np', calls: 2 },
      { filePath: 'model.py', head: 'torch', calls: 7 },
    ];

    expect(countPackageCalls(calls, external, heads, 2)).toEqual([
      { name: 'torch', calls: 7 },
      { name: 'math', calls: 2 },
    ]);
  });
});
