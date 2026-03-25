# Student Calendar Assistant - Product Spec Draft

## Idea

- The product helps students turn any schedule into structured digital data that can be used across multiple scenarios.
- As input, the service accepts not only text and tables, but also photos, screenshots, and even paper schedules captured from a board or hallway stand.
- In the MVP, the core job is to recognize the schedule, extract key entities such as date, time, subject, room, teacher, and class type, and normalize them into a unified format.
- Once the data is normalized, the product can support useful downstream actions such as export to `Google Calendar`, `Apple Calendar`, `Outlook`, `.ics`, and other third-party services.
- The main value of the MVP is not just calendar export, but creating a digital layer on top of chaotic and inconsistent schedule formats.

## Problem

- Student schedules often exist in formats that are readable for humans but unusable for digital workflows: photos of boards, screenshots from chats, PDFs, spreadsheets, or poorly structured university portals.
- Even when universities provide digital schedule tools, those solutions are often disconnected from the ecosystem students actually use every day.
- In practice, students often do not get convenient export to `Google Calendar`, `Apple Calendar`, or `Outlook`, and they also lack familiar notification channels such as phone reminders, email, or other personal productivity tools.
- As a result, schedule information may exist, but it is not available as structured, portable data that students can easily reuse and integrate into their daily lives.
- This forces students to manually check updates, rewrite classes into calendars, and keep academic planning separate from the rest of their routine.

## Target Audience

- The primary audience is students in universities and colleges who need a more convenient way to work with their academic schedule.
- This includes both students whose institutions have no meaningful digital schedule tools and students whose universities do provide digital access but in formats that are hard to reuse in everyday life.
- The product is especially relevant for students who already organize their life through personal calendars, reminders, and mobile productivity tools.
- A secondary audience includes group leaders, curators, and student communities who may use the product to quickly digitize and distribute schedules for others.

## Product Value

- The product turns schedule information from a static and inconvenient source into something actionable and reusable in everyday student life.
- It saves students time by removing the need to manually rewrite classes, recheck schedule boards, or recreate the same information in personal tools.
- It reduces the risk of missing classes, changes, or important academic events by making schedule data portable and easier to integrate into familiar workflows.
- It helps students manage study, work, and personal life in one place instead of keeping academic planning separate from everything else.
- More broadly, the product gives students control over schedule data that would otherwise remain locked inside fragmented or low-utility formats.

## MVP

- A student uploads a schedule as an image, screenshot, photo, or document.
- The product recognizes the schedule content, extracts key academic entities, and converts them into a normalized structured format.
- The student reviews the parsed schedule and corrects obvious mistakes if needed.
- After confirmation, the student exports the schedule directly into `Google Calendar`.
- The MVP demonstrates that messy, real-world student schedules can be transformed into usable digital calendar data with minimal manual effort.

## Out of Scope for MVP

- Support for multiple calendar providers beyond `Google Calendar`.
- Full two-way synchronization between the product and third-party calendar platforms.
- Advanced collaboration features for student groups, curators, or academic departments.
- Analytics, recommendations, assistant features, or AI-based planning beyond schedule recognition and normalization.
- Perfect support for every possible schedule format, institution, or edge case from day one.

## Hackathon Success Metrics

- A student can go from raw schedule input to a `Google Calendar` export in just a few minutes.
- The product correctly identifies and structures most core schedule information in common real-world examples.
- The amount of manual correction required before export is low enough that the workflow still feels faster than doing it by hand.
- Users clearly understand the benefit: they can take a messy schedule source and immediately turn it into something usable in their everyday digital routine.
- The demo creates a strong wow moment by showing that even a photo or screenshot can become a working personal calendar.

## Positioning

- The product is not just another schedule viewer, but a bridge between fragmented academic schedule sources and the digital tools students already rely on.
- It does not try to replace university systems; instead, it unlocks the data inside them and makes that data portable, useful, and student-centered.
- In the MVP, the clearest expression of this value is simple: turn a messy schedule source into a working `Google Calendar`.

## Future Potential

- While the MVP is focused on students, the underlying problem extends far beyond education.
- The same workflow can help people digitize and export work shifts, medical schedules, training plans, and other recurring timetables received as photos, screenshots, PDFs, or printed materials.
- This gives the product broader long-term potential as a universal bridge between real-world schedules and personal digital calendars.
