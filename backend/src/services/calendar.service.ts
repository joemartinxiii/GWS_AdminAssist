import { WorkspaceService } from './workspace.service';

export interface Calendar {
  id: string;
  summary: string;
  description?: string;
  timeZone: string;
  accessRole: string;
  primary: boolean;
}

export interface CalendarAcl {
  scope: {
    type: string;
    value?: string;
  };
  role: string;
}

export interface CalendarResource {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  capacity?: number;
  buildingId?: string;
  floorName?: string;
  featureInstances?: Array<{
    feature: {
      name: string;
    };
  }>;
}

export class CalendarService extends WorkspaceService {
  /**
   * List calendars for a user
   */
  async listCalendars(userEmail: string, targetEmail: string): Promise<Calendar[]> {
    await this.initialize(userEmail);
    
    // Set the subject to the target user for domain-wide delegation
    if (this.auth) {
      this.auth.subject = targetEmail;
    }

    try {
      const response = await this.withRetry(() =>
        this.calendar.calendarList.list({
          minAccessRole: 'reader',
        })
      );

      const calendars: Calendar[] = [];
      if (response.data.items) {
        for (const calendar of response.data.items) {
          calendars.push({
            id: calendar.id || '',
            summary: calendar.summary || '',
            description: calendar.description,
            timeZone: calendar.timeZone || '',
            accessRole: calendar.accessRole || '',
            primary: calendar.primary === true,
          });
        }
      }

      return calendars;
    } catch (error: any) {
      if (error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get calendar ACL (access control list)
   */
  async getCalendarAcl(userEmail: string, calendarId: string): Promise<CalendarAcl[]> {
    await this.initialize(userEmail);

    try {
      const response = await this.withRetry(() =>
        this.calendar.acl.list({
          calendarId,
        })
      );

      const acl: CalendarAcl[] = [];
      if (response.data.items) {
        for (const item of response.data.items) {
          acl.push({
            scope: {
              type: item.scope?.type || '',
              value: item.scope?.value,
            },
            role: item.role || '',
          });
        }
      }

      return acl;
    } catch (error: any) {
      if (error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * List calendar resources (rooms, equipment)
   */
  async listResources(userEmail: string): Promise<CalendarResource[]> {
    await this.initialize(userEmail);

    try {
      const response = await this.withRetry(() =>
        this.admin.resources.calendars.list({
          customer: 'my_customer',
        })
      );

      const resources: CalendarResource[] = [];
      if (response.data.items) {
        for (const resource of response.data.items) {
          resources.push({
            resourceId: resource.resourceId || '',
            resourceName: resource.resourceName || '',
            resourceType: resource.resourceType || '',
            capacity: resource.capacity,
            buildingId: resource.buildingId,
            floorName: resource.floorName,
            featureInstances: resource.featureInstances?.map(fi => ({
              feature: {
                name: fi.feature?.name || '',
              },
            })),
          });
        }
      }

      return resources;
    } catch (error: any) {
      if (error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Create calendar resource
   */
  async createResource(
    userEmail: string,
    resource: {
      resourceName: string;
      resourceType: string;
      capacity?: number;
      buildingId?: string;
      floorName?: string;
    }
  ): Promise<CalendarResource> {
    await this.initialize(userEmail);

    const response = await this.withRetry(() =>
      this.admin.resources.calendars.insert({
        customer: 'my_customer',
        requestBody: {
          resourceName: resource.resourceName,
          resourceType: resource.resourceType,
          capacity: resource.capacity,
          buildingId: resource.buildingId,
          floorName: resource.floorName,
        },
      })
    );

    return {
      resourceId: response.data.resourceId || '',
      resourceName: response.data.resourceName || '',
      resourceType: response.data.resourceType || '',
      capacity: response.data.capacity,
      buildingId: response.data.buildingId,
      floorName: response.data.floorName,
    };
  }

  /**
   * Update calendar resource
   */
  async updateResource(
    userEmail: string,
    resourceId: string,
    updates: Partial<{
      resourceName: string;
      capacity: number;
      buildingId: string;
      floorName: string;
    }>
  ): Promise<CalendarResource> {
    await this.initialize(userEmail);

    const response = await this.withRetry(() =>
      this.admin.resources.calendars.patch({
        customer: 'my_customer',
        calendarResourceId: resourceId,
        requestBody: updates,
      })
    );

    return {
      resourceId: response.data.resourceId || '',
      resourceName: response.data.resourceName || '',
      resourceType: response.data.resourceType || '',
      capacity: response.data.capacity,
      buildingId: response.data.buildingId,
      floorName: response.data.floorName,
    };
  }

  /**
   * Delete calendar resource
   */
  async deleteResource(userEmail: string, resourceId: string): Promise<void> {
    await this.initialize(userEmail);

    await this.withRetry(() =>
      this.admin.resources.calendars.delete({
        customer: 'my_customer',
        calendarResourceId: resourceId,
      })
    );
  }

  /**
   * List events for a user's calendar
   */
  async listEvents(
    userEmail: string,
    targetEmail: string,
    calendarId: string = 'primary',
    timeMin?: string,
    timeMax?: string,
    maxResults: number = 250
  ): Promise<any[]> {
    await this.initialize(userEmail);
    
    // Set the subject to the target user for domain-wide delegation
    if (this.auth) {
      this.auth.subject = targetEmail;
    }

    try {
      const response = await this.withRetry(() =>
        this.calendar.events.list({
          calendarId,
          timeMin: timeMin || new Date().toISOString(),
          timeMax,
          maxResults,
          singleEvents: true,
          orderBy: 'startTime',
        })
      );

      return response.data.items || [];
    } catch (error: any) {
      if (error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get a specific event
   */
  async getEvent(userEmail: string, targetEmail: string, calendarId: string, eventId: string): Promise<any> {
    await this.initialize(userEmail);
    
    // Set the subject to the target user for domain-wide delegation
    if (this.auth) {
      this.auth.subject = targetEmail;
    }

    const response = await this.withRetry(() =>
      this.calendar.events.get({
        calendarId,
        eventId,
      })
    );

    return response.data;
  }

  /**
   * Update an event (can update time, add invitees, etc.)
   */
  async updateEvent(
    userEmail: string,
    targetEmail: string,
    calendarId: string,
    eventId: string,
    updates: {
      summary?: string;
      description?: string;
      start?: { dateTime?: string; date?: string; timeZone?: string };
      end?: { dateTime?: string; date?: string; timeZone?: string };
      attendees?: Array<{ email: string; displayName?: string }>;
      location?: string;
    }
  ): Promise<any> {
    await this.initialize(userEmail);
    
    // Set the subject to the target user for domain-wide delegation
    if (this.auth) {
      this.auth.subject = targetEmail;
    }

    // First get the current event
    const currentEvent = await this.getEvent(userEmail, targetEmail, calendarId, eventId);

    // Merge updates with current event
    const updatedEvent: any = {
      summary: updates.summary !== undefined ? updates.summary : currentEvent.summary,
      description: updates.description !== undefined ? updates.description : currentEvent.description,
      location: updates.location !== undefined ? updates.location : currentEvent.location,
      start: updates.start || currentEvent.start,
      end: updates.end || currentEvent.end,
    };

    // Handle attendees - merge with existing if adding
    if (updates.attendees) {
      const existingEmails = new Set((currentEvent.attendees || []).map((a: any) => a.email));
      const newAttendees = updates.attendees.filter(a => !existingEmails.has(a.email));
      updatedEvent.attendees = [...(currentEvent.attendees || []), ...newAttendees];
    } else {
      updatedEvent.attendees = currentEvent.attendees;
    }

    const response = await this.withRetry(() =>
      this.calendar.events.update({
        calendarId,
        eventId,
        requestBody: updatedEvent,
        sendUpdates: 'all', // Send updates to all attendees
      })
    );

    return response.data;
  }

  /**
   * Add attendees to an event
   */
  async addAttendees(
    userEmail: string,
    targetEmail: string,
    calendarId: string,
    eventId: string,
    attendees: Array<{ email: string; displayName?: string }>
  ): Promise<any> {
    return this.updateEvent(userEmail, targetEmail, calendarId, eventId, { attendees });
  }

  /**
   * Move an event (update start and end times)
   */
  async moveEvent(
    userEmail: string,
    targetEmail: string,
    calendarId: string,
    eventId: string,
    newStart: string,
    newEnd: string,
    timeZone?: string
  ): Promise<any> {
    return this.updateEvent(userEmail, targetEmail, calendarId, eventId, {
      start: { dateTime: newStart, timeZone: timeZone || 'UTC' },
      end: { dateTime: newEnd, timeZone: timeZone || 'UTC' },
    });
  }

  /**
   * Delete an event
   */
  async deleteEvent(
    userEmail: string,
    targetEmail: string,
    calendarId: string,
    eventId: string,
    sendUpdates: 'all' | 'externalOnly' | 'none' = 'all'
  ): Promise<void> {
    await this.initialize(userEmail);
    
    // Set the subject to the target user for domain-wide delegation
    if (this.auth) {
      this.auth.subject = targetEmail;
    }

    await this.withRetry(() =>
      this.calendar.events.delete({
        calendarId,
        eventId,
        sendUpdates,
      })
    );
  }

  /**
   * Create a new event
   */
  async createEvent(
    userEmail: string,
    targetEmail: string,
    calendarId: string,
    event: {
      summary: string;
      description?: string;
      start: { dateTime: string; timeZone?: string };
      end: { dateTime: string; timeZone?: string };
      attendees?: Array<{ email: string; displayName?: string }>;
      location?: string;
    }
  ): Promise<any> {
    await this.initialize(userEmail);
    
    // Set the subject to the target user for domain-wide delegation
    if (this.auth) {
      this.auth.subject = targetEmail;
    }

    const response = await this.withRetry(() =>
      this.calendar.events.insert({
        calendarId,
        requestBody: {
          summary: event.summary,
          description: event.description,
          start: event.start,
          end: event.end,
          attendees: event.attendees,
          location: event.location,
        },
        sendUpdates: 'all',
      })
    );

    return response.data;
  }

  /**
   * Transfer an event from one user's calendar to another
   */
  async transferEvent(
    userEmail: string,
    sourceEmail: string,
    targetEmail: string,
    sourceCalendarId: string,
    targetCalendarId: string,
    eventId: string,
    deleteOriginal: boolean = false
  ): Promise<any> {
    // Get the original event
    const originalEvent = await this.getEvent(userEmail, sourceEmail, sourceCalendarId, eventId);

    // Create the event in the target user's calendar
    const newEvent = await this.createEvent(
      userEmail,
      targetEmail,
      targetCalendarId,
      {
        summary: originalEvent.summary || '',
        description: originalEvent.description,
        start: originalEvent.start || { dateTime: new Date().toISOString() },
        end: originalEvent.end || { dateTime: new Date().toISOString() },
        attendees: originalEvent.attendees,
        location: originalEvent.location,
      }
    );

    // Optionally delete the original event
    if (deleteOriginal) {
      await this.deleteEvent(userEmail, sourceEmail, sourceCalendarId, eventId, 'all');
    }

    return newEvent;
  }
}

export const calendarService = new CalendarService();
