package edu.srm.hallbooking.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** Someone who signed in with Google (email verified by Google). Roles are not stored: they come from APP_ACCOUNTS. */
@Entity
@Table(name = "app_user")
public class AppUser {

  /** The Google account's email, lower case. */
  @Id
  private String email;

  private String name;

  private String pictureUrl;

  private Instant firstLogin;

  private Instant lastLogin;

  protected AppUser() {}

  public AppUser(String email) {
    this.email = email;
  }

  public String getEmail() { return email; }
  public String getName() { return name; }
  public String getPictureUrl() { return pictureUrl; }
  public Instant getFirstLogin() { return firstLogin; }
  public Instant getLastLogin() { return lastLogin; }

  public void setName(String name) { this.name = name; }
  public void setPictureUrl(String pictureUrl) { this.pictureUrl = pictureUrl; }
  public void setFirstLogin(Instant firstLogin) { this.firstLogin = firstLogin; }
  public void setLastLogin(Instant lastLogin) { this.lastLogin = lastLogin; }
}
