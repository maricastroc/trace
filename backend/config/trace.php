<?php

return [
    'mode' => env('TRACE_MODE', 'local'),
    'uploads_enabled' => (bool) env('TRACE_UPLOADS_ENABLED', true),
    'limits' => [
        'upload_kb' => (int) env('TRACE_MAX_UPLOAD_KB', 10240),
        'rows' => (int) env('TRACE_MAX_ROWS', 50000),
        'columns' => (int) env('TRACE_MAX_COLUMNS', 100),
        'tuples' => (int) env('TRACE_MAX_TUPLES', 500000),
        'preview_rows' => 20,
    ],
    'workspace_ttl_days' => (int) env('TRACE_WORKSPACE_TTL_DAYS', 30),
    'demo_path' => database_path('demo'),
];
