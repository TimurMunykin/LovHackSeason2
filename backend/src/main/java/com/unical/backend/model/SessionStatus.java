package com.unical.backend.model;

public enum SessionStatus {
    STARTING,
    NAVIGATING_LOGIN,
    ACTIVE,
    NAVIGATING_SCHEDULE,
    EXTRACTING,
    SUCCESS,
    FAILED,
    IDLE
}
